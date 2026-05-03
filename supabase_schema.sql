-- GEST-IN-SITU Supabase Schema (PostgreSQL)

-- Enable RLS
-- Tables definitions

CREATE TABLE IF NOT EXISTS public.t_sites (
    id_site SERIAL PRIMARY KEY,
    nom_site TEXT NOT NULL UNIQUE,
    code_site TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.t_centres (
    id_centre SERIAL PRIMARY KEY,
    id_site INTEGER REFERENCES public.t_sites(id_site) ON DELETE CASCADE,
    nom_centre TEXT NOT NULL,
    code_centre TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.t_postes (
    id_poste SERIAL PRIMARY KEY,
    id_centre INTEGER REFERENCES public.t_centres(id_centre) ON DELETE CASCADE,
    nom_poste TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.t_cartes (
    id_carte BIGSERIAL PRIMARY KEY,
    num_secu TEXT,
    noms TEXT NOT NULL,
    prenoms TEXT,
    date_naissance DATE,
    lieu_naissance TEXT,
    sexe TEXT,
    contact TEXT,
    contact_2 TEXT,
    rangement TEXT,
    id_site INTEGER REFERENCES public.t_sites(id_site),
    id_centre INTEGER REFERENCES public.t_centres(id_centre),
    id_poste INTEGER REFERENCES public.t_postes(id_poste),
    statut TEXT DEFAULT 'EN STOCK',
    statut_physique TEXT DEFAULT 'OK',
    nom_retirant TEXT,
    num_retirant TEXT,
    date_delivrance TIMESTAMPTZ,
    agent_distributeur TEXT,
    centre_retrait TEXT,
    cle_doublon TEXT UNIQUE,
    cle_doublon_flex TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.t_logs (
    id_log BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    table_concernee TEXT NOT NULL,
    id_enregistrement BIGINT,
    date_action TIMESTAMPTZ DEFAULT NOW(),
    details TEXT,
    user_login TEXT
);

-- RLS Policies
ALTER TABLE public.t_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_postes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_cartes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_logs ENABLE ROW LEVEL SECURITY;

-- Simple Policy: Authenticated users can read everything
CREATE POLICY "Allow read access for authenticated users" ON public.t_sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.t_centres FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.t_postes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.t_cartes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read access for authenticated users" ON public.t_logs FOR SELECT TO authenticated USING (true);

-- Simple Policy: Only Admins can modify (example)
-- Note: In a real app, you'd use app_metadata or a separate profiles table
CREATE POLICY "Allow write access for authenticated users" ON public.t_cartes FOR ALL TO authenticated USING (true);
