-- ============================================================
-- 0009_versions_postes.sql
-- GEST-IN-SITU : table des versions de postes (chantier B, P1-2, objet C de
-- l'annexe B de docs/PLAN_P1_CHANTIER_B.md). Purement ADDITIF.
--
-- But : savoir quels postes tournent encore une version qui utilise
-- l'ancienne cle anon, avant de la desactiver (D6). Le client n'appelle PAS
-- encore cette RPC : l'appel cote poste est prevu en P2 (rien dans src/).
--
-- DEPEND DE 0008 (fonctions fn_write_audit_classe / fn_write_audit_client_info) :
-- appliquer 0008 avant 0009.
--
-- Ce que fait ce fichier :
--   1. t_client_versions : une ligne par poste (cle poste_key), RLS active
--      SANS politique, REVOKE ALL anon/authenticated -> illisible et non
--      modifiable par la cle publique.
--      key_kind = classe de cle CALCULEE COTE SERVEUR a partir des claims
--      (meme classement que 0008 : publishable, legacy_suppose,
--      authenticated, service_role, postgres, autre) ; jamais declaree par le
--      poste. client_info = x-client-info borne (64 caracteres).
--   2. fn_report_client_version(p_poste_key, p_app_version, p_user_sync_id,
--      p_site_sync_id) : SECURITY DEFINER, search_path fige, EXECUTE ouvert a
--      anon et authenticated. Renvoie seulement un booleen (true = accepte,
--      false = refuse), ne renvoie JAMAIS de ligne ni d'erreur (EXCEPTION WHEN
--      others -> false + WARNING avec SQLSTATE seul). Parametres bornes :
--        p_poste_key    : ^[A-Za-z0-9_-]{8,64}$ (uuid conseille) ;
--        p_app_version  : semver simple ^\d{1,4}\.\d{1,4}\.\d{1,6}
--                         (-[0-9A-Za-z.-]{1,32})?$ ;
--        p_user_sync_id, p_site_sync_id : facultatifs, ^[A-Za-z0-9_.:-]{1,64}$
--                         (sinon stockes NULL, l'appel reste accepte).
--      Une ligne par poste (upsert sur poste_key) ; plafond anti-abus :
--      un NOUVEAU poste est refuse si la table a deja 5000 lignes (un poste
--      deja connu est toujours mis a jour).
--
-- Securite : la RPC est la seule porte ; aucune lecture possible par anon ;
-- la table ne contient aucun secret ni donnee personnelle (sync_id
-- techniques, version, horodatages).
--
-- Idempotent : CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Aucune table metier touchee.
--
-- Interrupteur (immediat, sans DROP) : retirer l'acces a la RPC
--   REVOKE EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
--   (reactivation : GRANT EXECUTE ... TO anon, authenticated). Un poste P2
--   doit traiter l'erreur "permission denied" comme un simple echec silencieux.
-- Retour arriere complet :
--   DROP FUNCTION IF EXISTS public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT);
--   DROP TABLE IF EXISTS public.t_client_versions;
--
-- Lecture (SQL Editor) :
--   SELECT poste_key, app_version, key_kind, client_info, site_sync_id,
--          last_user_sync_id, first_seen_at, last_seen_at, nb_reports
--   FROM public.t_client_versions ORDER BY last_seen_at DESC;
--
-- Application : dev ajadkziqaskadlzboeqo : APPLIQUEE le 2026-11-13 (agent-4,
-- apply_migration) ; test SQL 14/14 ; appel REST reel avec la cle
-- publishable -> true, key_kind publishable ; lecture/ecriture directe de la
-- table refusee a anon (42501).
-- Production itvyayakwgzvfqvdrgyv : NON appliquee ; geste de l'utilisateur
-- (SQL Editor), juste apres 0008.
-- Test : supabase/tests/0009_versions_postes.test.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table (une ligne par poste)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_client_versions (
  poste_key         TEXT        PRIMARY KEY,
  app_version       TEXT        NOT NULL,
  key_kind          TEXT        NOT NULL,
  client_info       TEXT        NOT NULL DEFAULT '',
  last_user_sync_id TEXT,
  site_sync_id      TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nb_reports        BIGINT      NOT NULL DEFAULT 1,
  CONSTRAINT t_client_versions_poste_key_fmt CHECK (poste_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT t_client_versions_version_len   CHECK (length(app_version) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_client_versions_version  ON public.t_client_versions(app_version);
CREATE INDEX IF NOT EXISTS idx_client_versions_last_seen ON public.t_client_versions(last_seen_at);

ALTER TABLE public.t_client_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.t_client_versions FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. RPC de declaration de version
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_report_client_version(
  p_poste_key    TEXT,
  p_app_version  TEXT,
  p_user_sync_id TEXT DEFAULT NULL,
  p_site_sync_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '200ms'
AS $$
DECLARE
  v_user TEXT;
  v_site TEXT;
BEGIN
  IF p_poste_key IS NULL OR length(p_poste_key) > 64
     OR p_poste_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RETURN false;
  END IF;
  IF p_app_version IS NULL OR length(p_app_version) > 64
     OR p_app_version !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,32})?$' THEN
    RETURN false;
  END IF;
  IF p_user_sync_id IS NOT NULL AND length(p_user_sync_id) <= 64
     AND p_user_sync_id ~ '^[A-Za-z0-9_.:-]{1,64}$' THEN
    v_user := p_user_sync_id;
  END IF;
  IF p_site_sync_id IS NOT NULL AND length(p_site_sync_id) <= 64
     AND p_site_sync_id ~ '^[A-Za-z0-9_.:-]{1,64}$' THEN
    v_site := p_site_sync_id;
  END IF;

  -- Plafond anti-abus : nouveau poste refuse au-dela de 5000 lignes.
  IF NOT EXISTS (SELECT 1 FROM public.t_client_versions WHERE poste_key = p_poste_key)
     AND (SELECT count(*) FROM public.t_client_versions) >= 5000 THEN
    RETURN false;
  END IF;

  INSERT INTO public.t_client_versions AS v
    (poste_key, app_version, key_kind, client_info, last_user_sync_id, site_sync_id,
     first_seen_at, last_seen_at, nb_reports)
  VALUES
    (p_poste_key, p_app_version, public.fn_write_audit_classe(),
     public.fn_write_audit_client_info(), v_user, v_site, NOW(), NOW(), 1)
  ON CONFLICT (poste_key) DO UPDATE SET
    app_version       = EXCLUDED.app_version,
    key_kind          = EXCLUDED.key_kind,
    client_info       = EXCLUDED.client_info,
    last_user_sync_id = COALESCE(EXCLUDED.last_user_sync_id, v.last_user_sync_id),
    site_sync_id      = COALESCE(EXCLUDED.site_sync_id, v.site_sync_id),
    last_seen_at      = NOW(),
    nb_reports        = v.nb_reports + 1;
  RETURN true;
EXCEPTION WHEN others THEN
  RAISE WARNING 'fn_report_client_version : refuse (code %)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
