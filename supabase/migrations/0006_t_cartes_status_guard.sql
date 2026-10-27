-- ============================================================
-- 0006_t_cartes_status_guard.sql
-- GEST-IN-SITU : garde-fou serveur du "bloc statut" de t_cartes
-- (correctif rouge 4 / A-02 de l'audit 2026-10-26, ETAPE 1 sur 3).
--
-- Probleme : la fusion cloud est "le dernier envoi gagne" sur updated_at, qui
-- vaut l'heure d'ENVOI (upload-worker.js / payload-mapper.ts : updated_at =
-- pushedAt), pas l'heure de l'action. Un poste B revenu en ligne pousse une
-- copie figee "EN STOCK" (payload complet de t_outbox, upsert brut
-- onConflict sync_id, upload-worker.js:292) qui ecrase dans le cloud une
-- delivrance faite entre-temps par le poste A.
--
-- Regle (validee par l'utilisateur, plan agent-1) : fusion PAR GROUPE de champs.
--   * Le "bloc statut" suit la date de SON PROPRE evenement :
--       evt(ligne) = GREATEST(date_delivrance,
--                             fn_try_ts(apurement_annulation_le),
--                             fn_try_ts(apurement_correction_le),
--                             fn_try_ts(doublon_declare_le),
--                             fn_try_ts(doublon_annule_le))
--     (GREATEST ignore les NULL et ne renvoie NULL que si tous sont NULL :
--      documentation PostgreSQL 17 §9.18.4, verifie aussi par le test 0006).
--   * Tous les autres champs (identite, contact, rangement, bloc absence
--     statut_physique / signalements, etc.) gardent la regle actuelle : le
--     dernier envoi gagne. updated_at garde son role de curseur de
--     telechargement (fn_downstream_cartes_chunk) : il n'est jamais abaisse.
--
-- Bloc statut (21 colonnes, liste verifiee le 2026-10-27 dans
-- information_schema.columns du dev ET de la prod, identique) :
--   statut, date_delivrance, agent_distributeur, centre_retrait,
--   nom_retirant, num_retirant, contact_retirant, relation_retirant,
--   doublon_declare_par, doublon_declare_le, doublon_motif,
--   doublon_annule_par, doublon_annule_le, doublon_motif_annulation,
--   statut_avant_doublon,
--   apurement_correction_par, apurement_correction_le, apurement_correction_motif,
--   apurement_annulation_par, apurement_annulation_le, apurement_annulation_motif
--
-- Trigger BEFORE UPDATE (donc aussi la branche UPDATE d'un
-- INSERT ... ON CONFLICT DO UPDATE, cf. doc PostgreSQL 17 §37.1), qui
-- n'agit que si statut, date_delivrance, apurement_correction_le OU
-- apurement_annulation_le change (clause WHEN ; les deux derniers couvrent la
-- correction du retirant sans changement de date) :
--   1. evt(OLD) non NULL et (evt(NEW) NULL ou evt(NEW) < evt(OLD))
--        -> bloc OLD conserve, motif STATUT_EVT_PLUS_ANCIEN ;
--        (une vieille copie DELIVRE de meme date mais sans la correction de
--         retirant, ou avec une correction plus ancienne, tombe ici : son evt
--         est plus ancien que apurement_correction_le d'OLD) ;
--   2. sinon, OLD et NEW tous deux DELIVRE avec date_delivrance non NULL et
--      differentes, sans apurement_correction_le NI apurement_annulation_le
--      strictement plus recent dans NEW (NULL cote OLD = plus ancien)
--        -> bloc OLD conserve (la premiere delivrance arrivee gagne),
--           motif DOUBLE_DELIVRANCE.
--      L'exemption "annulation plus recente" couvre l'annulation puis la
--      nouvelle delivrance faites hors ligne sur le meme poste (le cloud ne
--      voit que l'etat final DELIVRE D2).
--   En cas de garde : les 21 colonnes reprennent la valeur OLD ;
--   action_at := GREATEST(OLD, NEW) ; updated_at := GREATEST(NEW, OLD) + 1 ms
--   (pour que tous les postes, y compris l'emetteur, re-telechargent la
--   verite cloud) ; une ligne est ajoutee dans t_sync_conflicts.
--   DOUBLON et ANNULE n'ont pas de rang particulier : meme regle de date.
--   L'INSERT d'une nouvelle carte n'est pas concerne (trigger UPDATE seul).
--   Le trigger ne leve JAMAIS d'erreur : toute exception interne renvoie la
--   ligne NEW d'origine, intacte (comportement d'avant la migration).
--
-- Securite : t_sync_conflicts en RLS active sans policy + REVOKE ALL pour
-- anon/authenticated (lisible seulement via service_role / SQL Editor). La
-- fonction trigger est SECURITY DEFINER (search_path fige) pour pouvoir
-- ecrire dans t_sync_conflicts quand l'upsert vient de la cle anon.
--
-- Idempotent : CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- CREATE OR REPLACE TRIGGER (PG >= 14 ; dev et prod en PG 17).
-- Aucun DROP, aucune colonne existante modifiee, aucune donnee modifiee.
--
-- Retour arriere immediat (sans perte) :
--   ALTER TABLE public.t_cartes DISABLE TRIGGER trg_t_cartes_status_guard;
--
-- Application : dev ajadkziqaskadlzboeqo le 2026-10-27 (agent-4, validee par
-- l'utilisateur). Production itvyayakwgzvfqvdrgyv : PAS APPLIQUEE, geste
-- explicite a valider par l'utilisateur (README.md, CLAUDE.md).
-- Test : supabase/tests/0006_t_cartes_status_guard.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Conversion texte -> timestamptz tolerante (NULL si impossible)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_try_ts(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 2. Journal des conflits arbitres par le garde-fou
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_sync_conflicts (
  id              BIGSERIAL PRIMARY KEY,
  sync_id         TEXT,
  id_site         BIGINT,
  kept_statut     TEXT,
  rejected_statut TEXT,
  kept_block      JSONB,
  rejected_block  JSONB,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_sync_id ON public.t_sync_conflicts(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_site_date ON public.t_sync_conflicts(id_site, created_at);

ALTER TABLE public.t_sync_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_sync_conflicts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.t_sync_conflicts_id_seq FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Fonction trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_t_cartes_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig     public.t_cartes;
  v_evt_old  TIMESTAMPTZ;
  v_evt_new  TIMESTAMPTZ;
  v_corr_old TIMESTAMPTZ;
  v_corr_new TIMESTAMPTZ;
  v_annu_old TIMESTAMPTZ;
  v_annu_new TIMESTAMPTZ;
  v_reason   TEXT := NULL;
  v_cols     CONSTANT TEXT[] := ARRAY[
    'statut','date_delivrance','agent_distributeur','centre_retrait',
    'nom_retirant','num_retirant','contact_retirant','relation_retirant',
    'doublon_declare_par','doublon_declare_le','doublon_motif',
    'doublon_annule_par','doublon_annule_le','doublon_motif_annulation',
    'statut_avant_doublon',
    'apurement_correction_par','apurement_correction_le','apurement_correction_motif',
    'apurement_annulation_par','apurement_annulation_le','apurement_annulation_motif'
  ];
BEGIN
  -- Copie intacte de la ligne entrante : renvoyee telle quelle en cas d'exception
  -- (les affectations faites sur NEW avant l'erreur ne sont pas annulees par
  -- le bloc EXCEPTION, seules les ecritures en base le sont).
  v_orig := NEW;

  BEGIN
    v_evt_old := GREATEST(OLD.date_delivrance,
                          public.fn_try_ts(OLD.apurement_annulation_le),
                          public.fn_try_ts(OLD.apurement_correction_le),
                          public.fn_try_ts(OLD.doublon_declare_le),
                          public.fn_try_ts(OLD.doublon_annule_le));
    v_evt_new := GREATEST(NEW.date_delivrance,
                          public.fn_try_ts(NEW.apurement_annulation_le),
                          public.fn_try_ts(NEW.apurement_correction_le),
                          public.fn_try_ts(NEW.doublon_declare_le),
                          public.fn_try_ts(NEW.doublon_annule_le));

    IF v_evt_old IS NOT NULL AND (v_evt_new IS NULL OR v_evt_new < v_evt_old) THEN
      v_reason := 'STATUT_EVT_PLUS_ANCIEN';
    ELSIF OLD.statut = 'DELIVRE' AND NEW.statut = 'DELIVRE'
          AND OLD.date_delivrance IS NOT NULL AND NEW.date_delivrance IS NOT NULL
          AND OLD.date_delivrance <> NEW.date_delivrance THEN
      v_corr_old := public.fn_try_ts(OLD.apurement_correction_le);
      v_corr_new := public.fn_try_ts(NEW.apurement_correction_le);
      v_annu_old := public.fn_try_ts(OLD.apurement_annulation_le);
      v_annu_new := public.fn_try_ts(NEW.apurement_annulation_le);
      IF NOT (v_corr_new IS NOT NULL AND (v_corr_old IS NULL OR v_corr_new > v_corr_old))
         AND NOT (v_annu_new IS NOT NULL AND (v_annu_old IS NULL OR v_annu_new > v_annu_old)) THEN
        v_reason := 'DOUBLE_DELIVRANCE';
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.t_sync_conflicts
      (sync_id, id_site, kept_statut, rejected_statut, kept_block, rejected_block, reason, created_at)
    VALUES (
      OLD.sync_id,
      COALESCE(OLD.id_site, NEW.id_site),
      OLD.statut,
      NEW.statut,
      (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(to_jsonb(OLD)) e WHERE e.key = ANY (v_cols)),
      (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(to_jsonb(NEW)) e WHERE e.key = ANY (v_cols)),
      v_reason,
      NOW()
    );

    NEW.statut                     := OLD.statut;
    NEW.date_delivrance            := OLD.date_delivrance;
    NEW.agent_distributeur         := OLD.agent_distributeur;
    NEW.centre_retrait             := OLD.centre_retrait;
    NEW.nom_retirant               := OLD.nom_retirant;
    NEW.num_retirant               := OLD.num_retirant;
    NEW.contact_retirant           := OLD.contact_retirant;
    NEW.relation_retirant          := OLD.relation_retirant;
    NEW.doublon_declare_par        := OLD.doublon_declare_par;
    NEW.doublon_declare_le         := OLD.doublon_declare_le;
    NEW.doublon_motif              := OLD.doublon_motif;
    NEW.doublon_annule_par         := OLD.doublon_annule_par;
    NEW.doublon_annule_le          := OLD.doublon_annule_le;
    NEW.doublon_motif_annulation   := OLD.doublon_motif_annulation;
    NEW.statut_avant_doublon       := OLD.statut_avant_doublon;
    NEW.apurement_correction_par   := OLD.apurement_correction_par;
    NEW.apurement_correction_le    := OLD.apurement_correction_le;
    NEW.apurement_correction_motif := OLD.apurement_correction_motif;
    NEW.apurement_annulation_par   := OLD.apurement_annulation_par;
    NEW.apurement_annulation_le    := OLD.apurement_annulation_le;
    NEW.apurement_annulation_motif := OLD.apurement_annulation_motif;

    NEW.action_at  := GREATEST(OLD.action_at, NEW.action_at);
    NEW.updated_at := GREATEST(NEW.updated_at, OLD.updated_at) + INTERVAL '1 millisecond';

    RETURN NEW;
  EXCEPTION WHEN others THEN
    -- Jamais d'erreur vers l'envoi : comportement d'avant la migration.
    RAISE WARNING 'fn_t_cartes_status_guard ignore (sync_id=%) : % %', OLD.sync_id, SQLSTATE, SQLERRM;
    RETURN v_orig;
  END;
END;
$$;

-- Fonction trigger : aucun appel direct legitime (un trigger ne verifie pas le
-- droit EXECUTE de l'utilisateur qui declenche l'UPDATE).
REVOKE ALL ON FUNCTION public.fn_t_cartes_status_guard() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Trigger
-- ------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_t_cartes_status_guard
  BEFORE UPDATE ON public.t_cartes
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut
        OR OLD.date_delivrance IS DISTINCT FROM NEW.date_delivrance
        OR OLD.apurement_correction_le IS DISTINCT FROM NEW.apurement_correction_le
        OR OLD.apurement_annulation_le IS DISTINCT FROM NEW.apurement_annulation_le)
  EXECUTE FUNCTION public.fn_t_cartes_status_guard();
