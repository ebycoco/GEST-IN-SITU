-- ============================================================
-- GEST-IN-SITU : SchÃ©ma Supabase/PostgreSQL officiel
-- Version : alignÃ©e sur schema.ts v18 + mapping bulk-uploader.ts
-- GÃ©nÃ©rÃ© le : 2026-07-03
-- ============================================================
-- RELATION AVEC supabase/migrations/ (depuis le 19/08/2026)
-- ============================================================
-- Ce fichier reste la VUE D'ENSEMBLE lisible du schéma complet, pratique
-- pour une relecture globale ou pour amorcer un nouvel environnement.
-- Mais ce n'est plus la source de vérité du processus de changement :
-- toute évolution FUTURE du schéma (nouvelle table, colonne, index,
-- fonction RPC, policy RLS...) doit désormais être écrite D'ABORD comme un
-- nouveau fichier dans supabase/migrations/ (voir supabase/migrations/README.md
-- pour la convention et la procédure d'application manuelle sur dev PUIS
-- prod), puis reportée ICI en second lieu pour que ce document reste
-- synchronisé avec l'état réel. Ne plus modifier ce fichier en premier.
--
-- L'état actuel de ce fichier a été rétroactivement découpé en baseline
-- dans supabase/migrations/0001_baseline_schema.sql et
-- supabase/migrations/0002_t_user_presence.sql (cause du dernier écart
-- dev/prod corrigé le 19/08/2026 : la section t_user_presence ci-dessous
-- avait été appliquée à la main en production sans geste équivalent côté
-- dev, faute d'un mécanisme de migration tracé).
-- ============================================================

-- ============================================================
-- 0. NETTOYAGE : DROP dans l'ordre (enfants avant parents)
-- ============================================================
DROP TABLE IF EXISTS public.t_cartes CASCADE;
DROP TABLE IF EXISTS public.t_logs CASCADE;
DROP TABLE IF EXISTS public.t_users CASCADE;
DROP TABLE IF EXISTS public.t_postes CASCADE;
DROP TABLE IF EXISTS public.t_centres CASCADE;
DROP TABLE IF EXISTS public.t_sites CASCADE;


-- ============================================================
-- 1. t_sites
-- ============================================================
CREATE TABLE public.t_sites (
    id          BIGSERIAL PRIMARY KEY,
    nom         TEXT NOT NULL,
    code        TEXT UNIQUE NOT NULL,
    is_active   INTEGER DEFAULT 1,
    max_centres INTEGER DEFAULT 4,
    sync_id     TEXT UNIQUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expiry_date TIMESTAMPTZ,
    is_permanent BOOLEAN DEFAULT FALSE,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. t_centres
-- Mapping local : site_id -> site_id (FK t_sites.id)
-- ============================================================
CREATE TABLE public.t_centres (
    id                  BIGSERIAL PRIMARY KEY,
    site_id             BIGINT REFERENCES public.t_sites(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    numero              INTEGER CHECK(numero BETWEEN 1 AND 4),
    lieu                TEXT,
    prefixe_rangement   TEXT,
    sync_id             TEXT UNIQUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. t_postes
-- ============================================================
CREATE TABLE public.t_postes (
    id          BIGSERIAL PRIMARY KEY,
    centre_id   BIGINT REFERENCES public.t_centres(id) ON DELETE CASCADE,
    nom         TEXT NOT NULL,
    numero      INTEGER CHECK(numero BETWEEN 1 AND 4),
    sync_id     TEXT UNIQUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. t_users (v18 final)
-- ============================================================
CREATE TABLE public.t_users (
    id_user         BIGSERIAL PRIMARY KEY,
    login           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN (
                        'SUPER ADMIN',
                        'ADMINISTRATEUR_SITE',
                        'ADMIN_CENTRE',
                        'OPERATEUR_VERIFICATION',
                        'OPERATEUR_QUALITE',
                        'OPERATEUR_SAISIE',
                        'OPERATEUR_LOGISTIQUE',
                        'OPERATEUR_INVENTAIRE',
                        'OPERATEUR_APUREMENT'
                    )),
    nom_user        TEXT,
    prenom_user     TEXT,
    email           TEXT,
    telephone       TEXT,
    statut_actif    INTEGER DEFAULT 1,
    site_id         BIGINT DEFAULT 1 REFERENCES public.t_sites(id),
    centre_id       BIGINT REFERENCES public.t_centres(id),
    poste_id        BIGINT REFERENCES public.t_postes(id),
    avatar_url      TEXT,
    last_login      TIMESTAMPTZ,
    sync_id         TEXT UNIQUE,
    is_dirty        INTEGER DEFAULT 0,
    synced_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. t_cartes â€” TABLE PRINCIPALE (200k+ lignes)
-- Mapping bulk-uploader.ts :
--   date_de_naissance -> date_naissance
--   lieu_de_naissance -> lieu_naissance
--   site_id           -> id_site
--   centre_id         -> id_centre
--   poste_id          -> id_poste
-- ============================================================
CREATE TABLE public.t_cartes (
    id_carte                    BIGSERIAL PRIMARY KEY,
    sync_id                     TEXT UNIQUE,
    noms                        TEXT NOT NULL,
    prenoms                     TEXT NOT NULL DEFAULT '',
    date_naissance              DATE,
    lieu_naissance              TEXT,
    num_secu                    TEXT,
    lieu_enrolement             TEXT,
    contact                     TEXT,
    rangement                   TEXT,
    statut                      TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE','BROUILLON','DOUBLON')),
    statut_physique             TEXT DEFAULT 'OK' CHECK(statut_physique IN ('OK','ABSENT','RETROUVE','PERDUE')),
    date_delivrance             TIMESTAMPTZ,
    agent_saisie                TEXT,
    agent_distributeur          TEXT,
    centre_retrait              TEXT,
    nom_retirant                TEXT,
    num_retirant                TEXT,
    cle_doublon                 TEXT,
    cle_doublon_flex            TEXT,
    agent_signalement_absence   TEXT,
    date_signalement_absence    TIMESTAMPTZ,
    date_resolution_absence     TIMESTAMPTZ,
    agent_resolution_absence    TEXT,
    note_resolution             TEXT,
    notif_lue                   INTEGER DEFAULT 1,
    id_site                     BIGINT DEFAULT 1 REFERENCES public.t_sites(id),
    id_centre                   BIGINT REFERENCES public.t_centres(id),
    id_poste                    BIGINT REFERENCES public.t_postes(id),
    qr_code_data                TEXT,
    is_exported                 INTEGER DEFAULT 0,
    created_by                  BIGINT REFERENCES public.t_users(id_user),
    is_dirty                    INTEGER DEFAULT 0,
    synced_at                   TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW(),
    -- Correction/annulation d'un émargement Apurement (voir
    -- supabase/migrations/0003_apurement_correction_annulation.sql — appliqué
    -- sur dev/staging le 22/08/2026 ; production à traiter séparément) :
    apurement_correction_par    TEXT,
    apurement_correction_le     TEXT,
    apurement_correction_motif  TEXT,
    apurement_annulation_par    TEXT,
    apurement_annulation_le     TEXT,
    apurement_annulation_motif  TEXT,
    -- Horodatage d'action métier, distinct du watermark réseau updated_at (voir
    -- supabase/migrations/0004_action_at.sql — PRÉPARÉ, PAS ENCORE APPLIQUÉ sur
    -- dev/staging ni production à la date de rédaction). Reçoit la même valeur
    -- qu'updated_at à chaque écriture métier locale (même transaction), mais
    -- n'est jamais recalculé par les mappings d'envoi réseau ni par la fusion
    -- downstream — contrairement à updated_at, qui reste exclusivement le
    -- watermark de synchro/arbitrage LWW (fix e3a7005).
    action_at                   TIMESTAMPTZ
);

-- ============================================================
-- 6. t_logs â€” Journal d'audit
-- ============================================================
CREATE TABLE public.t_logs (
    id_log          BIGSERIAL PRIMARY KEY,
    id_user         BIGINT REFERENCES public.t_users(id_user),
    login_user      TEXT,
    action          TEXT NOT NULL,
    detail          TEXT,
    valeur_avant    TEXT,
    valeur_apres    TEXT,
    date_heure      TIMESTAMPTZ DEFAULT NOW(),
    ip_address      TEXT,
    centre_id       BIGINT REFERENCES public.t_centres(id),
    site_id         BIGINT REFERENCES public.t_sites(id),
    sync_id         TEXT UNIQUE,
    is_dirty        INTEGER DEFAULT 0,
    synced_at       TIMESTAMPTZ
);

-- ============================================================
-- 7. INDEX DE PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cartes_noms          ON public.t_cartes(noms);
CREATE INDEX IF NOT EXISTS idx_cartes_prenoms        ON public.t_cartes(prenoms);
CREATE INDEX IF NOT EXISTS idx_cartes_num_secu       ON public.t_cartes(num_secu);
CREATE INDEX IF NOT EXISTS idx_cartes_rangement      ON public.t_cartes(rangement);
CREATE INDEX IF NOT EXISTS idx_cartes_statut         ON public.t_cartes(statut);
CREATE INDEX IF NOT EXISTS idx_cartes_statut_phys    ON public.t_cartes(statut_physique);
CREATE INDEX IF NOT EXISTS idx_cartes_cle_doublon    ON public.t_cartes(cle_doublon);
CREATE INDEX IF NOT EXISTS idx_cartes_cle_flex       ON public.t_cartes(cle_doublon_flex);
CREATE INDEX IF NOT EXISTS idx_cartes_id_centre      ON public.t_cartes(id_centre);
CREATE INDEX IF NOT EXISTS idx_cartes_id_site        ON public.t_cartes(id_site);
CREATE INDEX IF NOT EXISTS idx_cartes_sync           ON public.t_cartes(is_dirty, synced_at);
CREATE INDEX IF NOT EXISTS idx_cartes_updated        ON public.t_cartes(updated_at);
CREATE INDEX IF NOT EXISTS idx_cartes_contact        ON public.t_cartes(contact);
CREATE INDEX IF NOT EXISTS idx_cartes_site_statut    ON public.t_cartes(id_site, statut);
CREATE INDEX IF NOT EXISTS idx_cartes_sync_id        ON public.t_cartes(sync_id);
-- Index composite dédié à la pagination keyset du pull downstream (runDownstreamChunk,
-- src/main/sync/downstream.ts) : sans lui, le filtre id_site + tri (updated_at, sync_id)
-- force un tri complet des lignes candidates, qui dépasse le statement_timeout Supabase
-- sur les sites à fort volume (ex: timeout constaté site 4, ~40 700 cartes, 2026-08-17).
CREATE INDEX IF NOT EXISTS idx_cartes_site_updated_syncid ON public.t_cartes(id_site, updated_at, sync_id);
CREATE INDEX IF NOT EXISTS idx_logs_date             ON public.t_logs(date_heure);
CREATE INDEX IF NOT EXISTS idx_logs_action           ON public.t_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_sync_id          ON public.t_logs(sync_id);
-- Même justification que idx_cartes_site_updated_syncid ci-dessus, pour la pagination
-- keyset de runLogsDownstreamChunk (src/main/sync/downstream.ts).
CREATE INDEX IF NOT EXISTS idx_logs_site_date_syncid ON public.t_logs(site_id, date_heure, sync_id);

-- ============================================================
-- 7bis. FONCTIONS RPC — PAGINATION KEYSET DOWNSTREAM (t_cartes / t_logs)
-- ============================================================
-- PostgREST ne sait pas exprimer une comparaison de tuple `(a,b) > (x,y)` via son DSL
-- .or()/.filter() : ces deux fonctions encapsulent la vraie clause côté serveur pour
-- garantir à Postgres un unique Index Scan trié sur les index composites ci-dessus,
-- sans jamais retomber sur un plan BitmapOr + Sort (cause du statement timeout site 4,
-- ~40 700 cartes, 2026-08-17). Appelées via .rpc(...) depuis runDownstreamChunk et
-- runLogsDownstreamChunk (src/main/sync/downstream.ts). LANGUAGE sql (pas plpgsql) pour
-- rester éligible à l'inlining par le planificateur à chaque appel.
CREATE OR REPLACE FUNCTION public.fn_downstream_cartes_chunk(
  p_site_id BIGINT, p_watermark TIMESTAMPTZ, p_last_sync_id TEXT, p_limit INT DEFAULT 500
)
RETURNS SETOF public.t_cartes
LANGUAGE sql STABLE
AS $$
  SELECT * FROM public.t_cartes
  WHERE id_site = p_site_id AND (updated_at, sync_id) > (p_watermark, p_last_sync_id)
  ORDER BY updated_at ASC, sync_id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.fn_downstream_cartes_chunk(BIGINT, TIMESTAMPTZ, TEXT, INT)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_downstream_logs_chunk(
  p_site_id BIGINT, p_watermark TIMESTAMPTZ, p_last_sync_id TEXT, p_limit INT DEFAULT 500
)
RETURNS TABLE (
  id_user BIGINT, login_user TEXT, action TEXT, detail TEXT, valeur_avant TEXT,
  valeur_apres TEXT, date_heure TIMESTAMPTZ, centre_id BIGINT, site_id BIGINT, sync_id TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT id_user, login_user, action, detail, valeur_avant, valeur_apres, date_heure, centre_id, site_id, sync_id
  FROM public.t_logs
  WHERE site_id = p_site_id AND (date_heure, sync_id) > (p_watermark, p_last_sync_id)
  ORDER BY date_heure ASC, sync_id ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.fn_downstream_logs_chunk(BIGINT, TIMESTAMPTZ, TEXT, INT)
  TO anon, authenticated, service_role;

-- ============================================================
-- 7ter. GARDE-FOU DU "BLOC STATUT" DE t_cartes (rouge 4 / A-02)
-- ============================================================
-- Source : supabase/migrations/0006_t_cartes_status_guard.sql (applique sur
-- dev ajadkziqaskadlzboeqo le 2026-10-27 ; PAS sur la production a cette date).
-- Le bloc statut (statut, date_delivrance, agent_distributeur, centre_retrait,
-- nom/num/contact/relation_retirant, doublon_*, statut_avant_doublon,
-- apurement_*) suit la date de son propre evenement
--   evt = GREATEST(date_delivrance, fn_try_ts(apurement_annulation_le),
--                  fn_try_ts(apurement_correction_le), fn_try_ts(doublon_declare_le),
--                  fn_try_ts(doublon_annule_le))
-- au lieu de "le dernier envoi gagne". Si une mise a jour apporte un evt plus
-- ancien (STATUT_EVT_PLUS_ANCIEN) ou une seconde delivrance differente sans
-- apurement_correction_le ni apurement_annulation_le plus recent
-- (DOUBLE_DELIVRANCE), le bloc OLD est conserve, les
-- autres colonnes passent, updated_at = GREATEST(NEW, OLD) + 1 ms, et le
-- conflit est journalise dans t_sync_conflicts. Ne leve jamais d'erreur.
-- Declenche si statut, date_delivrance, apurement_correction_le ou
-- apurement_annulation_le change (correction du retirant sans changement de date).
-- Retour arriere : ALTER TABLE public.t_cartes DISABLE TRIGGER trg_t_cartes_status_guard;
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

CREATE TABLE IF NOT EXISTS public.t_sync_conflicts (
  id              BIGSERIAL PRIMARY KEY,
  sync_id         TEXT,
  id_site         BIGINT,
  kept_statut     TEXT,
  rejected_statut TEXT,
  kept_block      JSONB,
  rejected_block  JSONB,
  reason          TEXT NOT NULL,   -- 'STATUT_EVT_PLUS_ANCIEN' | 'DOUBLE_DELIVRANCE'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_sync_id ON public.t_sync_conflicts(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_site_date ON public.t_sync_conflicts(id_site, created_at);
-- Exception volontaire a la section 8/9 : RLS active sans policy, aucun droit
-- pour anon/authenticated (lecture via service_role / SQL Editor uniquement).
ALTER TABLE public.t_sync_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_sync_conflicts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.t_sync_conflicts_id_seq FROM anon, authenticated;

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
CREATE OR REPLACE TRIGGER trg_t_cartes_status_guard
  BEFORE UPDATE ON public.t_cartes
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut
        OR OLD.date_delivrance IS DISTINCT FROM NEW.date_delivrance
        OR OLD.apurement_correction_le IS DISTINCT FROM NEW.apurement_correction_le
        OR OLD.apurement_annulation_le IS DISTINCT FROM NEW.apurement_annulation_le)
  EXECUTE FUNCTION public.fn_t_cartes_status_guard();

-- ============================================================
-- 8. RLS : DÃ‰SACTIVÃ‰ sur toutes les tables
-- ============================================================
ALTER TABLE public.t_sites    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_centres  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_postes   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_users    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_cartes   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_logs     DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. GRANTS complets pour anon, authenticated, service_role
-- ============================================================
GRANT ALL ON public.t_sites    TO anon, authenticated, service_role;
GRANT ALL ON public.t_centres  TO anon, authenticated, service_role;
GRANT ALL ON public.t_postes   TO anon, authenticated, service_role;
GRANT ALL ON public.t_users    TO anon, authenticated, service_role;
GRANT ALL ON public.t_cartes   TO anon, authenticated, service_role;
GRANT ALL ON public.t_logs     TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
DROP TABLE IF EXISTS public.t_app_version CASCADE;
CREATE TABLE public.t_app_version (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    min_version VARCHAR(20) NOT NULL,
    latest_version VARCHAR(20) NOT NULL,
    release_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.t_app_version (min_version, latest_version, release_notes) VALUES ('2.4.2', '2.4.2', 'Version initiale avec auto-updater.');


-- ============================================================================
-- TABLE : t_user_roles (Roles multiples par agent)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.t_user_roles (
    id SERIAL PRIMARY KEY,
    user_sync_id TEXT NOT NULL REFERENCES public.t_users(sync_id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_sync_id, role)
);

-- Activation du RLS
ALTER TABLE public.t_user_roles ENABLE ROW LEVEL SECURITY;

-- Autoriser la lecture et l'écriture
CREATE POLICY "Enable read access for all users" ON public.t_user_roles FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.t_user_roles FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.t_user_roles FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.t_user_roles FOR DELETE USING (true);


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
-- REFERENCES t_sites(id)/t_centres(id) — cf. section 4 ci-dessus).
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
-- désactivé sur toutes les tables" de la section 8 ci-dessous est OBSOLÈTE/fausse
-- pour ces tables, ne pas s'y fier ; correction de la section 8 elle-même laissée
-- en dehors du périmètre de cet ajout).
ALTER TABLE public.t_user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_operations_t_user_presence" ON public.t_user_presence
FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.t_user_presence TO anon, authenticated, service_role;

