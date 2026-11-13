-- =====================================================================================================
-- P1-3 (chantier B) — Diagnostic de cohérence site/centre dans le cloud Supabase
-- -----------------------------------------------------------------------------------------------------
-- LECTURE SEULE : uniquement des SELECT, aucune écriture, aucune fonction qui écrit.
-- Sortie volontairement sans donnée personnelle : comptes agrégés, identifiants techniques
-- (id numériques, sync_id tronqué à 8 caractères), codes/noms de SITE et de CENTRE (des lieux), rôles.
-- On ne sélectionne JAMAIS login, nom, prénom, email, téléphone, password_hash, numéro de carte.
--
-- Contexte : bug historique « site_id local envoyé au cloud » (corrigé dans le code le 2026-10-31).
-- Dans le cloud, les références sont NUMÉRIQUES et désignent les id CLOUD :
--   t_users.site_id/centre_id/poste_id, t_cartes.id_site/id_centre/id_poste, t_centres.site_id,
--   t_postes.centre_id, t_logs.site_id/centre_id, t_user_presence.site_id/centre_id (FK réelles).
--   t_user_roles et t_user_presence pointent le compte par user_sync_id (FK réelle vers t_users.sync_id).
-- Aucune FK n'existe sur t_users, t_cartes, t_centres, t_postes, t_logs : les orphelins y sont possibles.
--
-- Trois blocs indépendants, à lancer un par un (l'éditeur SQL n'affiche que le dernier résultat) :
--   BLOC 1 : tableau de synthèse (une ligne par contrôle, colonne nb).
--   BLOC 2 : détail des anomalies (au plus 20 lignes par catégorie, identifiants techniques seulement).
--   BLOC 3 : vue par site (centres, comptes, cartes, présence) pour repérer un rattachement suspect.
-- =====================================================================================================


-- =====================================================================================================
-- BLOC 1 — Synthèse
-- =====================================================================================================
WITH
s AS (SELECT id, code, sync_id FROM public.t_sites),
c AS (SELECT id, site_id, numero, nom, sync_id FROM public.t_centres),
u AS (SELECT id_user, role, site_id, centre_id, poste_id, sync_id, statut_actif FROM public.t_users),
ur AS (SELECT DISTINCT user_sync_id FROM public.t_user_roles WHERE role = 'SUPER ADMIN')
SELECT * FROM (
  -- ---------- t_sites / t_centres / t_postes ----------
  SELECT 'A01 sites (total)' AS controle, count(*) AS nb FROM s
  UNION ALL SELECT 'A02 sites sans sync_id', count(*) FROM s WHERE sync_id IS NULL OR sync_id = ''
  UNION ALL SELECT 'A03 codes site en double (insensible casse/espaces)', count(*) FROM (
      SELECT upper(trim(code)) FROM s GROUP BY 1 HAVING count(*) > 1) x
  UNION ALL SELECT 'A04 centres (total)', count(*) FROM c
  UNION ALL SELECT 'A05 centres sans sync_id', count(*) FROM c WHERE sync_id IS NULL OR sync_id = ''
  UNION ALL SELECT 'A06 centres sans site (site_id NULL)', count(*) FROM c WHERE site_id IS NULL
  UNION ALL SELECT 'A07 centres dont le site n''existe pas', count(*) FROM c
      WHERE site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = c.site_id)
  UNION ALL SELECT 'A08 groupes de centres en double (même site + même numéro)', count(*) FROM (
      SELECT site_id, numero FROM c WHERE numero IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) x
  UNION ALL SELECT 'A09 groupes de centres en double (même site + même nom)', count(*) FROM (
      SELECT site_id, upper(trim(nom)) FROM c GROUP BY 1,2 HAVING count(*) > 1) x
  UNION ALL SELECT 'A10 postes (total)', count(*) FROM public.t_postes
  UNION ALL SELECT 'A11 postes dont le centre n''existe pas', count(*) FROM public.t_postes p
      WHERE p.centre_id IS NULL OR NOT EXISTS (SELECT 1 FROM c WHERE c.id = p.centre_id)
  UNION ALL SELECT 'A12 postes sans sync_id', count(*) FROM public.t_postes WHERE sync_id IS NULL OR sync_id = ''

  -- ---------- t_users ----------
  UNION ALL SELECT 'B01 comptes (total)', count(*) FROM u
  UNION ALL SELECT 'B02 comptes sans sync_id', count(*) FROM u WHERE sync_id IS NULL OR sync_id = ''
  UNION ALL SELECT 'B03 SUPER ADMIN (rôle primaire)', count(*) FROM u WHERE role = 'SUPER ADMIN'
  UNION ALL SELECT 'B04 SUPER ADMIN (rôle primaire ou t_user_roles)', count(*) FROM u
      WHERE role = 'SUPER ADMIN' OR sync_id IN (SELECT user_sync_id FROM ur)
  UNION ALL SELECT 'B05 SUPER ADMIN rattachés à un site', count(*) FROM u
      WHERE role = 'SUPER ADMIN' AND site_id IS NOT NULL
  UNION ALL SELECT 'B06 comptes non-SUPER ADMIN sans site', count(*) FROM u
      WHERE role IS DISTINCT FROM 'SUPER ADMIN' AND site_id IS NULL
  UNION ALL SELECT 'B07 comptes dont le site n''existe pas', count(*) FROM u
      WHERE site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = u.site_id)
  UNION ALL SELECT 'B08 comptes dont le centre n''existe pas', count(*) FROM u
      WHERE centre_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM c WHERE c.id = u.centre_id)
  UNION ALL SELECT 'B09 comptes dont le centre appartient à un AUTRE site', count(*) FROM u
      JOIN c ON c.id = u.centre_id WHERE u.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM u.site_id
  UNION ALL SELECT 'B10 comptes avec centre mais sans site', count(*) FROM u
      WHERE centre_id IS NOT NULL AND site_id IS NULL
  UNION ALL SELECT 'B11 comptes dont le poste n''existe pas', count(*) FROM u
      WHERE poste_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.t_postes p WHERE p.id = u.poste_id)

  -- ---------- t_user_roles ----------
  UNION ALL SELECT 'C01 lignes t_user_roles (total)', count(*) FROM public.t_user_roles
  UNION ALL SELECT 'C02 rôles orphelins (compte inexistant)', count(*) FROM public.t_user_roles r
      WHERE NOT EXISTS (SELECT 1 FROM u WHERE u.sync_id = r.user_sync_id)
  UNION ALL SELECT 'C03 comptes dont le rôle primaire est absent de t_user_roles', count(*) FROM u
      WHERE u.sync_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.t_user_roles r WHERE r.user_sync_id = u.sync_id AND r.role = u.role)
  UNION ALL SELECT 'C04 comptes avec rôle SUPER ADMIN secondaire mais un site', count(*) FROM u
      WHERE u.sync_id IN (SELECT user_sync_id FROM ur) AND u.role <> 'SUPER ADMIN' AND u.site_id IS NOT NULL

  -- ---------- t_cartes ----------
  UNION ALL SELECT 'D01 cartes (total)', count(*) FROM public.t_cartes
  UNION ALL SELECT 'D02 cartes sans sync_id', count(*) FROM public.t_cartes WHERE sync_id IS NULL OR sync_id = ''
  UNION ALL SELECT 'D03 cartes sans site (id_site NULL)', count(*) FROM public.t_cartes WHERE id_site IS NULL
  UNION ALL SELECT 'D04 cartes dont le site n''existe pas', count(*) FROM public.t_cartes k
      WHERE k.id_site IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = k.id_site)
  UNION ALL SELECT 'D05 cartes dont le centre n''existe pas', count(*) FROM public.t_cartes k
      WHERE k.id_centre IS NOT NULL AND NOT EXISTS (SELECT 1 FROM c WHERE c.id = k.id_centre)
  UNION ALL SELECT 'D06 cartes dont le centre appartient à un AUTRE site', count(*) FROM public.t_cartes k
      JOIN c ON c.id = k.id_centre WHERE c.site_id IS DISTINCT FROM k.id_site
  UNION ALL SELECT 'D07 cartes dont le poste n''existe pas', count(*) FROM public.t_cartes k
      WHERE k.id_poste IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.t_postes p WHERE p.id = k.id_poste)

  -- ---------- t_logs ----------
  UNION ALL SELECT 'E01 journaux (total)', count(*) FROM public.t_logs
  UNION ALL SELECT 'E02 journaux dont le site n''existe pas', count(*) FROM public.t_logs l
      WHERE l.site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = l.site_id)
  UNION ALL SELECT 'E03 journaux dont le centre n''existe pas', count(*) FROM public.t_logs l
      WHERE l.centre_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM c WHERE c.id = l.centre_id)
  UNION ALL SELECT 'E04 journaux dont le centre appartient à un AUTRE site', count(*) FROM public.t_logs l
      JOIN c ON c.id = l.centre_id WHERE l.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM l.site_id
  UNION ALL SELECT 'E05 journaux dont id_user ne correspond à aucun compte cloud', count(*) FROM public.t_logs l
      WHERE l.id_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM u WHERE u.id_user = l.id_user)

  -- ---------- t_user_presence ----------
  UNION ALL SELECT 'F01 présences (total)', count(*) FROM public.t_user_presence
  UNION ALL SELECT 'F02 présences dont le centre appartient à un AUTRE site', count(*) FROM public.t_user_presence p
      JOIN c ON c.id = p.centre_id WHERE p.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM p.site_id
  UNION ALL SELECT 'F03 présences dont le site diffère de celui du compte (t_users)', count(*) FROM public.t_user_presence p
      JOIN u ON u.sync_id = p.user_sync_id
      WHERE p.site_id IS DISTINCT FROM u.site_id AND u.role IS DISTINCT FROM 'SUPER ADMIN'
) t;


-- =====================================================================================================
-- BLOC 2 — Détail des anomalies (20 lignes max par catégorie, identifiants techniques seulement)
-- =====================================================================================================
WITH
s AS (SELECT id, code, sync_id FROM public.t_sites),
c AS (SELECT id, site_id, numero, nom, sync_id FROM public.t_centres),
u AS (SELECT id_user, role, site_id, centre_id, sync_id FROM public.t_users),
det AS (
  SELECT 'A03 code site en double' AS cat, 'site' AS objet, s.id AS id_tech, left(s.sync_id, 8) AS sync8,
         s.id AS site_ref, NULL::bigint AS centre_ref, s.code AS info
    FROM s WHERE upper(trim(s.code)) IN (SELECT upper(trim(code)) FROM s GROUP BY 1 HAVING count(*) > 1)
  UNION ALL SELECT 'A07/A06 centre sans site valide', 'centre', c.id, left(c.sync_id, 8), c.site_id, c.id,
         'centre n°' || coalesce(c.numero::text, '?') || ' ' || coalesce(c.nom, '')
    FROM c WHERE c.site_id IS NULL OR NOT EXISTS (SELECT 1 FROM s WHERE s.id = c.site_id)
  UNION ALL SELECT 'A08/A09 centre en double', 'centre', c.id, left(c.sync_id, 8), c.site_id, c.id,
         'centre n°' || coalesce(c.numero::text, '?') || ' ' || coalesce(c.nom, '')
    FROM c WHERE (c.site_id, c.numero) IN (SELECT site_id, numero FROM c WHERE numero IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1)
       OR (c.site_id, upper(trim(c.nom))) IN (SELECT site_id, upper(trim(nom)) FROM c GROUP BY 1,2 HAVING count(*) > 1)
  UNION ALL SELECT 'B02 compte sans sync_id', 'compte', u.id_user, NULL, u.site_id, u.centre_id, u.role
    FROM u WHERE u.sync_id IS NULL OR u.sync_id = ''
  UNION ALL SELECT 'B05 SUPER ADMIN rattaché à un site', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id, u.role
    FROM u WHERE u.role = 'SUPER ADMIN' AND u.site_id IS NOT NULL
  UNION ALL SELECT 'B06 compte non-SA sans site', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id, u.role
    FROM u WHERE u.role IS DISTINCT FROM 'SUPER ADMIN' AND u.site_id IS NULL
  UNION ALL SELECT 'B07 compte : site inexistant', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id, u.role
    FROM u WHERE u.site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = u.site_id)
  UNION ALL SELECT 'B08 compte : centre inexistant', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id, u.role
    FROM u WHERE u.centre_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM c WHERE c.id = u.centre_id)
  UNION ALL SELECT 'B09 compte : centre d''un autre site', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id,
         u.role || ' (centre du site ' || coalesce(c.site_id::text, 'NULL') || ')'
    FROM u JOIN c ON c.id = u.centre_id WHERE u.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM u.site_id
  UNION ALL SELECT 'C02 rôle orphelin', 'role', r.id, left(r.user_sync_id, 8), NULL, NULL, r.role
    FROM public.t_user_roles r WHERE NOT EXISTS (SELECT 1 FROM u WHERE u.sync_id = r.user_sync_id)
  UNION ALL SELECT 'C03 rôle primaire absent de t_user_roles', 'compte', u.id_user, left(u.sync_id, 8), u.site_id, u.centre_id, u.role
    FROM u WHERE u.sync_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.t_user_roles r WHERE r.user_sync_id = u.sync_id AND r.role = u.role)
  UNION ALL SELECT 'F03 présence : site ≠ site du compte', 'presence', NULL, left(p.user_sync_id, 8), p.site_id, p.centre_id,
         p.role || ' (compte : site ' || coalesce(u.site_id::text, 'NULL') || ')'
    FROM public.t_user_presence p JOIN u ON u.sync_id = p.user_sync_id
    WHERE p.site_id IS DISTINCT FROM u.site_id AND u.role IS DISTINCT FROM 'SUPER ADMIN'
  UNION ALL SELECT 'F02 présence : centre d''un autre site', 'presence', NULL, left(p.user_sync_id, 8), p.site_id, p.centre_id, p.role
    FROM public.t_user_presence p JOIN c ON c.id = p.centre_id
    WHERE p.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM p.site_id
  -- Cartes : agrégées par (site, centre) pour ne jamais lister de numéro de carte
  UNION ALL SELECT 'D04/D05/D06 cartes incohérentes (agrégé)', 'cartes', count(*), NULL, k.id_site, k.id_centre,
         CASE WHEN k.id_site IS NULL THEN 'site NULL'
              WHEN NOT EXISTS (SELECT 1 FROM s WHERE s.id = k.id_site) THEN 'site inexistant'
              WHEN NOT EXISTS (SELECT 1 FROM c WHERE c.id = k.id_centre) THEN 'centre inexistant'
              ELSE 'centre d''un autre site' END
    FROM public.t_cartes k LEFT JOIN c ON c.id = k.id_centre
    WHERE k.id_site IS NULL
       OR NOT EXISTS (SELECT 1 FROM s WHERE s.id = k.id_site)
       OR (k.id_centre IS NOT NULL AND c.id IS NULL)
       OR (c.id IS NOT NULL AND c.site_id IS DISTINCT FROM k.id_site)
    GROUP BY k.id_site, k.id_centre
  -- Journaux : agrégés par (site, centre)
  UNION ALL SELECT 'E02/E03/E04 journaux incohérents (agrégé)', 'logs', count(*), NULL, l.site_id, l.centre_id,
         CASE WHEN l.site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = l.site_id) THEN 'site inexistant'
              WHEN c.id IS NULL THEN 'centre inexistant'
              ELSE 'centre d''un autre site' END
    FROM public.t_logs l LEFT JOIN c ON c.id = l.centre_id
    WHERE (l.site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s WHERE s.id = l.site_id))
       OR (l.centre_id IS NOT NULL AND c.id IS NULL)
       OR (c.id IS NOT NULL AND l.site_id IS NOT NULL AND c.site_id IS DISTINCT FROM l.site_id)
    GROUP BY l.site_id, l.centre_id, c.id
)
SELECT cat, objet, id_tech, sync8, site_ref, centre_ref, info
FROM (SELECT det.*, row_number() OVER (PARTITION BY cat ORDER BY site_ref NULLS FIRST, id_tech) AS rn FROM det) z
WHERE rn <= 20
ORDER BY cat, rn;


-- =====================================================================================================
-- BLOC 3 — Vue par site (comptes agrégés ; permet de repérer un site « fantôme » ou un site
-- qui porte des comptes/cartes d'un autre site)
-- =====================================================================================================
SELECT s.id AS site_id, s.code, s.nom, left(s.sync_id, 8) AS sync8, s.is_active,
       (SELECT count(*) FROM public.t_centres c WHERE c.site_id = s.id)                         AS nb_centres,
       (SELECT count(*) FROM public.t_users u WHERE u.site_id = s.id)                           AS nb_comptes,
       (SELECT count(*) FROM public.t_users u WHERE u.site_id = s.id AND u.statut_actif = 1)    AS nb_comptes_actifs,
       (SELECT count(*) FROM public.t_cartes k WHERE k.id_site = s.id)                          AS nb_cartes,
       (SELECT count(*) FROM public.t_logs l WHERE l.site_id = s.id)                            AS nb_journaux,
       (SELECT count(*) FROM public.t_user_presence p WHERE p.site_id = s.id)                   AS nb_presences
FROM public.t_sites s
ORDER BY s.id;


-- =====================================================================================================
-- BLOC 4 — Cartes rattachées à un site inexistant : profil agrégé (aide à la décision de réparation)
-- Par (site, centre, statut) : nombre, dates, et combien partagent une cle_doublon avec une carte d'un
-- site existant (indice d'import en double d'un même fichier). Aucun numéro de carte affiché.
-- =====================================================================================================
SELECT k.id_site, k.id_centre, coalesce(k.statut, 'NULL') AS statut, count(*) AS nb,
       min(k.created_at)::date AS cree_min, max(k.updated_at)::date AS maj_max,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.t_cartes k2
          WHERE k2.cle_doublon = k.cle_doublon AND k2.id_site IN (SELECT id FROM public.t_sites))) AS cle_doublon_sur_site_existant
FROM public.t_cartes k
WHERE k.id_site IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.t_sites s WHERE s.id = k.id_site)
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
