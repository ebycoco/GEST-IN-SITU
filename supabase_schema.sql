-- ============================================================
-- GEST-IN-SITU : Schéma Supabase/PostgreSQL officiel
-- Version : alignée sur schema.ts v18 + mapping bulk-uploader.ts
-- Généré le : 2026-07-03
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
                        'OPERATEUR_INVENTAIRE'
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
-- 5. t_cartes — TABLE PRINCIPALE (200k+ lignes)
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
    statut                      TEXT DEFAULT 'EN STOCK' CHECK(statut IN ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE')),
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
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. t_logs — Journal d'audit
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
CREATE INDEX IF NOT EXISTS idx_logs_date             ON public.t_logs(date_heure);
CREATE INDEX IF NOT EXISTS idx_logs_action           ON public.t_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_sync_id          ON public.t_logs(sync_id);

-- ============================================================
-- 8. RLS : DÉSACTIVÉ sur toutes les tables
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
