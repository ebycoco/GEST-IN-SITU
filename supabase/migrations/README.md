# Migrations Supabase — GEST-IN-SITU

## Pourquoi ce dossier existe

Jusqu'au 19/08/2026, `supabase_schema.sql` (racine du dépôt) était le seul document
décrivant le schéma Supabase/PostgreSQL, mais **rien ne le rejouait jamais**
automatiquement sur les deux projets Supabase du projet :

| Projet | Ref | Usage |
|---|---|---|
| Dev/Staging | `ajadkziqaskadlzboeqo` (GEST-IN-SITU-DEV) | tests e2e-cloud (`allowRealSync: true`), aucune donnée citoyenne réelle |

> **Historique :** le projet dev d'origine (`zddibqgutigwxjwbojmn`) a été supprimé par erreur
> puis recréé le 2026-10-10 sous la référence `ajadkziqaskadlzboeqo`, en rejouant `0001` → `0005`.
> Les anciens commentaires des fichiers SQL citant `zddibqgutigwxjwbojmn` sont conservés
> tels quels (historique daté). `.env.e2e` et `e2e/fixtures/supabase-dev-client.ts` pointent
> sur le nouveau projet.
| Production | `itvyayakwgzvfqvdrgyv` | postes de terrain Côte d'Ivoire, données réelles |

Conséquence : le 17/08/2026, la table `t_user_presence` a été créée **à la main
en production** (commit `e67326c`, section ajoutée dans `supabase_schema.sql`)
sans le même geste côté dev. L'écart a été détecté puis corrigé manuellement le
19/08/2026. Ce dossier existe pour que ça ne se reproduise plus : chaque
évolution de schéma devient un fichier tracé et rejouable à l'identique sur les
deux projets.

## Règle à partir de maintenant

**Toute évolution du schéma Supabase (nouvelle table, colonne, index, fonction
RPC, policy RLS, etc.) doit d'abord être écrite comme un nouveau fichier dans
ce dossier — jamais exécutée directement en base sans fichier correspondant.**

1. Créer un nouveau fichier `NNNN_description_courte.sql` (voir convention
   ci-dessous).
2. Écrire le DDL (idéalement idempotent : `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, etc., pour
   pouvoir être rejoué sans casse si une base est déjà partiellement à jour).
3. Appliquer ce fichier **manuellement, dans cet ordre, sur les deux
   projets** : dev/staging (`ajadkziqaskadlzboeqo`) **puis** production
   (`itvyayakwgzvfqvdrgyv`) — jamais un seul des deux. Le rôle `agent-4-db-sync`
   ne fait qu'écrire les fichiers ; l'application réelle sur les projets
   Supabase reste un geste explicite validé par l'utilisateur (même logique
   que l'interdiction de build/release automatique, cf. `CLAUDE.md` §1).
4. Reporter ensuite le changement dans `supabase_schema.sql` (racine du
   dépôt) pour que ce document de référence reste synchronisé avec l'état
   réel — voir la note en tête de ce fichier.

## Convention de nommage

Le projet n'utilise pas (encore) la Supabase CLI (`supabase init` n'a jamais
été lancé : pas de `supabase/config.toml`, pas de script `package.json`
dédié). En son absence, convention simple retenue :

```
NNNN_description_courte_en_snake_case.sql
```

- `NNNN` : entier sur 4 chiffres, zéro-paddé, strictement croissant dans
  l'ordre chronologique d'écriture (`0001`, `0002`, `0003`, …). Ne jamais
  réutiliser ou réordonner un numéro déjà commité.
- `description_courte` : quelques mots résumant le changement
  (ex. `t_user_presence`, `ajout_index_cartes_statut`).

Si la Supabase CLI est adoptée plus tard (`supabase link` + `supabase db
push`/`db diff`), elle utilise nativement un préfixe horodaté
(`<YYYYMMDDHHMMSS>_description.sql`) et une table de suivi
`supabase_migrations.schema_migrations` côté serveur. Les fichiers `NNNN_*`
existants pourront être renommés avec un timestamp au moment de cette
adoption (le contenu SQL, lui, n'a pas besoin de changer) ; ce travail
d'installation/configuration de la CLI n'a pas été fait dans le cadre de la
présente mise en place — voir limitation ci-dessous.

## Fichiers actuels

- **`0001_baseline_schema.sql`** — schéma de référence tel qu'il existait sur
  dev et prod à la création de ce dossier (19/08/2026) : `t_sites`,
  `t_centres`, `t_postes`, `t_users`, `t_cartes`, `t_logs`, index de
  performance, fonctions RPC de pagination keyset downstream, RLS/GRANTS,
  `t_app_version`, `t_user_roles`. **Ce fichier est un instantané rétroactif
  déjà appliqué sur les deux projets — ne pas le rejouer tel quel** (il
  contient des `DROP TABLE ... CASCADE` sur les tables principales, ce qui
  détruirait les données réelles en production). Il sert de point de départ
  documentaire et de base pour reconstruire un environnement neuf si
  nécessaire (ex. nouveau projet Supabase de test).
- **`0002_t_user_presence.sql`** — capture rétroactive de l'ajout réel du
  17/08/2026 (commit `e67326c`), qui n'avait pas suivi cette convention à
  l'époque (d'où l'écart dev/prod initial). Isolé du fichier baseline pour
  illustrer le format attendu d'une migration incrémentale normale : ciblée,
  idempotente (`IF NOT EXISTS`), sans toucher au reste du schéma. Également
  déjà appliqué sur les deux projets — ne pas le rejouer sans vérifier au
  préalable que la table n'existe pas déjà (le `IF NOT EXISTS` protège
  cependant contre une double exécution accidentelle, contrairement au
  fichier 0001).

- **`0003_apurement_correction_annulation.sql`** — 6 colonnes `apurement_correction_*` /
  `apurement_annulation_*` sur `t_cartes` (idempotent).
- **`0004_action_at.sql`** — colonne `action_at` sur `t_cartes` + backfill `action_at = updated_at`
  (idempotent).
- **`0005_t_cartes_colonnes_manquantes.sql`** — rattrapage de 12 colonnes de `t_cartes`
  (`contact_retirant`, `relation_retirant`, 7 colonnes de traçabilité doublon,
  `note_signalement_absence`, `escalade_niveau`, `has_invalid_date`), ajoutées à la main sur la
  production et l'ancien dev mais jamais écrites en migration. Appliquée sur le dev recréé le
  2026-10-10. **Production : déjà conforme** (vérifié en lecture seule le 2026-10-10 sur
  `information_schema` : les 12 colonnes existent avec les mêmes types, plus des valeurs par
  défaut `escalade_niveau = 'CENTRE'` et `has_invalid_date = 0` que le dev n'a pas — sans
  incidence, l'application envoie toujours ces valeurs). Aucune application sur la production
  n'est nécessaire. Idempotente.
- **`0006_t_cartes_status_guard.sql`** — garde-fou serveur du « bloc statut » de `t_cartes`
  (trigger `trg_t_cartes_status_guard`, journal `t_sync_conflicts`). Appliquée sur le dev le
  2026-10-27 et sur la **production le 2026-11-01** (vérifiée : trigger actif, 2 fonctions,
  `t_sync_conflicts` en RLS, 0 ligne). Test : `supabase/tests/0006_t_cartes_status_guard.test.sql`.
- **`0007_t_users_super_admin_guard.sql`** — garde-fou anti-SUPER ADMIN via la clé anon
  (neutralisation silencieuse, jamais d'erreur renvoyée au poste) : triggers sur `t_users`
  et `t_user_roles`, interrupteur `t_security_guard_config`, journal `t_security_guard_events`.
  Test : `supabase/tests/0007_t_users_super_admin_guard.test.sql`. Appliquée sur le **dev** et
  la **production le 2026-11-13** (test 20/20, appels REST réels et test vivant agent-13 :
  journal `jwt_role = anon`). Idempotente.
- **`0008_mesure_ecritures_cles.sql`** — mesure silencieuse des écritures par type de clé
  (chantier B, P1-1) : compteurs agrégés `t_write_audit` (jour, table, opération, rôle JWT,
  **noms** des claims, `x-client-info` borné, classe `publishable` / `legacy_suppose` /
  `authenticated` / `service_role` / `postgres` / `autre`), interrupteur
  `t_write_audit_config`, 24 triggers STATEMENT `trg_wa_<table>_ins|upd|del` sur t_cartes,
  t_users, t_user_roles, t_logs, t_sites, t_centres, t_postes, t_user_presence. Ne lève jamais
  d'erreur vers le poste, ne modifie aucune ligne métier. Test :
  `supabase/tests/0008_mesure_ecritures_cles.test.sql`. **Dev : appliquée le 2026-11-13, puis
  version corrigée (réserves de l'audit agent-9 : `lock_timeout` de protection en tête,
  `classe` dans la clé primaire, `anon` sans claims classé `autre`) réappliquée le même jour
  après retour arrière. Production : appliquée le 2026-11-13 vers 23 h 40** (contrôle 12/12 OK ;
  procédure ci-dessous).
- **`0009_versions_postes.sql`** — table `t_client_versions` (une ligne par poste, illisible
  par anon) + RPC `fn_report_client_version(poste_key, app_version, user_sync_id, site_sync_id)`
  **fermée par défaut** (`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` en fin de
  fichier, jusqu'à P2), paramètres bornés, renvoie seulement un booléen ; la classe de clé est
  calculée côté serveur. **Dépend de 0008.** Aucun appel côté poste avant P2. Test :
  `supabase/tests/0009_versions_postes.test.sql`. **Dev : appliquée le 2026-11-13, puis
  version corrigée (RPC fermée, `lock_timeout` de protection) réappliquée le même jour.
  Production : appliquée le 2026-11-13 vers 23 h 40, juste après 0008 ; RPC fermée.**
- **`0010_lecture_versions_postes.sql`** — lecture pour l'écran SUPER ADMIN « Versions des postes »
  (`docs/PLAN_ECRAN_VERSIONS_POSTES.md`) : `fn_list_client_versions()` (au plus 1000 postes,
  `poste_ref` = 8 premiers caractères de la clé, jamais la clé complète ; écarte `preuve-%` et les
  lignes sans site ni utilisateur reconnus) et `fn_count_client_versions()` (une ligne :
  `nb_total`, `nb_preuve`, `nb_ignorees`, `nb_listables`). SECURITY DEFINER, STABLE, search_path
  figé, EXECUTE ouvert à anon et authenticated (**à refermer en P2**, voir brouillon P3 dans
  `docs/PLAN_P1_CHANTIER_B.md`). **Dépend de 0009**, ne la modifie pas (la RPC d'écriture reste
  fermée). Test : `supabase/tests/0010_lecture_versions_postes.test.sql`. **Dev : appliquée le
  2026-11-14** (test 14/14, appel REST réel avec la clé publishable conforme). **Production : appliquée le
  2026-11-14 (après accord écrit de l'utilisateur) ; étape 0 4/4 OK, contrôle 4/4 OK, comptage 0/0/0/0 ;
  la RPC d'envoi `fn_report_client_version` était encore FERMÉE à ce moment. GRANT d'ouverture fait
  le 2026-11-14 après publication de v2.27.0, sur accord écrit : RPC OUVERTE à anon/authenticated,
  `t_client_versions` toujours illisible directement.**
- **`dev_align_rls_prod.sql`** — **DEV UNIQUEMENT, NE PAS APPLIQUER EN PROD**, hors
  numérotation : aligne la RLS du dev sur l'état réel de la prod (politiques
  `allow_all_operations_*`), pour des essais représentatifs. Déjà appliqué sur le dev le
  2026-11-13.

## Appliquer une migration (dev puis prod)

1. **Dev** (`ajadkziqaskadlzboeqo`) : coller le fichier dans le SQL Editor du dev (ou
   `apply_migration` de l'outil MCP, par agent-4 avec accord), puis rejouer son test
   `supabase/tests/NNNN_*.test.sql` (transaction annulée) et les tests des migrations
   précédentes qui touchent les mêmes tables (0006, 0007).
2. **Prod** (`itvyayakwgzvfqvdrgyv`) : geste de l'utilisateur seulement, hors heures de
   travail des postes si la migration crée des triggers sur une table métier (verrou court
   `ShareRowExclusiveLock` à la création du trigger). Coller le fichier entier dans le SQL
   Editor du projet prod, entouré de `BEGIN;` … `COMMIT;` quand le fichier commence par
   `SET LOCAL lock_timeout` (0008, 0009 : procédure détaillée plus bas), exécuter, puis faire
   les vérifications en lecture indiquées. **Ne jamais exécuter un fichier `supabase/tests/*` en prod.**
3. Mettre à jour la ligne « Application » en tête du fichier et ce README.

## 0008 / 0009 : procédure de production (réserves de l'audit agent-9 levées le 2026-11-13)

**Quand** : hors heures de travail des postes (aucun poste en synchronisation). 0008 crée 24
triggers : chaque `CREATE TRIGGER` prend un `ShareRowExclusiveLock` sur la table métier
(niveau confirmé par la doc PostgreSQL 17 et mesuré sur le dev), qui bloque les écritures des
postes le temps de la création.

**Étape 0 — vérification préalable, lecture seule** (SQL Editor du projet prod). Toutes les
lignes doivent être `OK` ; une seule ligne `KO - ARRETER` → ne rien appliquer.

```sql
WITH
objets(o) AS (VALUES
  (to_regclass('public.t_write_audit')::text), (to_regclass('public.t_write_audit_config')::text),
  (to_regclass('public.t_client_versions')::text),
  (to_regprocedure('public.fn_write_audit_stmt()')::text), (to_regprocedure('public.fn_write_audit_classe()')::text),
  (to_regprocedure('public.fn_write_audit_client_info()')::text), (to_regprocedure('public.fn_write_audit_claim_keys()')::text),
  (to_regprocedure('public.fn_write_audit_claims()')::text),
  (to_regprocedure('public.fn_report_client_version(text,text,text,text)')::text)),
metier(t) AS (VALUES ('t_cartes'), ('t_users'), ('t_user_roles'), ('t_logs'), ('t_sites'), ('t_centres'), ('t_postes'), ('t_user_presence')),
chk(n, verification, observe, ok) AS (
  SELECT 1, 'objets 0008/0009 absents (to_regclass / to_regprocedure tous NULL)',
         (SELECT count(*) FROM objets WHERE o IS NOT NULL)::text || ' present(s)',
         (SELECT count(*) FROM objets WHERE o IS NOT NULL) = 0
  UNION ALL
  SELECT 2, 'aucun trigger trg_wa_%',
         (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\_wa\_%')::text,
         (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\_wa\_%') = 0
  UNION ALL
  SELECT 3, 'aucune transaction ouverte depuis plus de 60 s (hors cette session)',
         (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND xact_start < now() - interval '60 seconds')::text,
         (SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND xact_start < now() - interval '60 seconds') = 0
  UNION ALL
  SELECT 4, 'aucun autovacuum "to prevent wraparound" en cours',
         (SELECT count(*) FROM pg_stat_activity WHERE query ILIKE 'autovacuum:%wraparound%')::text,
         (SELECT count(*) FROM pg_stat_activity WHERE query ILIKE 'autovacuum:%wraparound%') = 0
  UNION ALL
  SELECT 5, 'aucun verrou tenu par une autre session sur les 8 tables metier',
         (SELECT count(*) FROM pg_locks l JOIN metier m ON l.relation = to_regclass('public.' || m.t)
           WHERE l.pid <> pg_backend_pid() AND l.mode NOT IN ('AccessShareLock'))::text,
         (SELECT count(*) FROM pg_locks l JOIN metier m ON l.relation = to_regclass('public.' || m.t)
           WHERE l.pid <> pg_backend_pid() AND l.mode NOT IN ('AccessShareLock')) = 0
)
SELECT n, verification, observe, CASE WHEN ok THEN 'OK' ELSE 'KO - ARRETER' END AS resultat FROM chk ORDER BY n;
```

**Étape 1 — appliquer 0008, un seul bloc.** Dans un nouvel onglet du SQL Editor, écrire
`BEGIN;`, coller **tout** le fichier `0008_mesure_ecritures_cles.sql`, écrire `COMMIT;` à la
fin, puis exécuter l'onglet en une fois. Le fichier commence par
`SET LOCAL lock_timeout = '3s';` et un contrôle qui arrête tout si ce réglage n'est pas actif.
- Erreur **55P03** (`lock_not_available` / « canceling statement due to lock timeout ») : un
  verrou n'a pas été obtenu en 3 s, **tout est annulé**, rien n'est créé. Rejouer plus tard
  (refaire l'étape 0 avant).
- Toute autre erreur : tout est annulé de même ; ne pas réessayer, transmettre le message.
- Après une erreur, vérifier qu'aucune session n'est restée ouverte :
  `SELECT pid, state, xact_start FROM pg_stat_activity WHERE state LIKE 'idle in transaction%';`
  Si une ligne apparaît pour votre session, exécuter `ROLLBACK;` seul dans l'onglet.

**Étape 2 — appliquer 0009**, même méthode (`BEGIN;` + fichier entier + `COMMIT;`). 0009
vérifie lui-même que 0008 est en place. La RPC reste **fermée** (voir plus bas).

**Étape 3 — contrôle, lecture seule.** Toutes les lignes doivent être `OK`. Une ligne `KO` →
interrupteur (ordre d'urgence n° 1) puis transmettre le résultat.

```sql
WITH
tabs(t) AS (VALUES ('public.t_write_audit'), ('public.t_write_audit_config'), ('public.t_client_versions')),
roles(r) AS (VALUES ('anon'), ('authenticated')),
fns(f) AS (VALUES ('public.fn_write_audit_stmt()'), ('public.fn_write_audit_classe()'),
                  ('public.fn_write_audit_client_info()'), ('public.fn_write_audit_claim_keys()'),
                  ('public.fn_write_audit_claims()')),
rpc AS (SELECT to_regprocedure('public.fn_report_client_version(text,text,text,text)') AS oid),
trg AS (SELECT to_regprocedure('public.fn_write_audit_stmt()') AS oid),
chk(n, verification, attendu, observe, ok) AS (
  SELECT 1, '24 triggers trg_wa_% actifs sur fn_write_audit_stmt', '24',
         (SELECT count(*) FROM pg_trigger x, trg WHERE x.tgname LIKE 'trg\_wa\_%' AND x.tgenabled = 'O' AND x.tgfoid = trg.oid)::text,
         (SELECT count(*) FROM pg_trigger x, trg WHERE x.tgname LIKE 'trg\_wa\_%' AND x.tgenabled = 'O' AND x.tgfoid = trg.oid) = 24
  UNION ALL
  SELECT 2, 't_write_audit_config.enabled', 'true',
         COALESCE((SELECT enabled::text FROM public.t_write_audit_config WHERE id = 1), 'absent'),
         COALESCE((SELECT enabled FROM public.t_write_audit_config WHERE id = 1), false)
  UNION ALL
  SELECT 3, 'RLS active sur les 3 tables', '3',
         (SELECT count(*) FROM tabs JOIN pg_class c ON c.oid = to_regclass(tabs.t) WHERE c.relrowsecurity)::text,
         (SELECT count(*) FROM tabs JOIN pg_class c ON c.oid = to_regclass(tabs.t) WHERE c.relrowsecurity) = 3
  UNION ALL
  SELECT 4, 'aucune politique sur les 3 tables', '0',
         (SELECT count(*) FROM pg_policy p JOIN tabs ON p.polrelid = to_regclass(tabs.t))::text,
         (SELECT count(*) FROM pg_policy p JOIN tabs ON p.polrelid = to_regclass(tabs.t)) = 0
           AND (SELECT count(*) FROM tabs WHERE to_regclass(tabs.t) IS NULL) = 0
  UNION ALL
  SELECT 5, 'aucun droit anon/authenticated (SELECT,INSERT,UPDATE,DELETE,TRUNCATE) sur les 3 tables', '0',
         (SELECT count(*) FROM tabs, roles
           WHERE to_regclass(tabs.t) IS NULL
              OR has_table_privilege(roles.r, to_regclass(tabs.t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))::text,
         (SELECT count(*) FROM tabs, roles
           WHERE to_regclass(tabs.t) IS NULL
              OR has_table_privilege(roles.r, to_regclass(tabs.t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) = 0
  UNION ALL
  SELECT 6, 'aucun EXECUTE anon/authenticated sur fn_write_audit_* (5 fonctions)', '0',
         (SELECT count(*) FROM fns, roles
           WHERE to_regprocedure(fns.f) IS NULL OR has_function_privilege(roles.r, to_regprocedure(fns.f), 'EXECUTE'))::text,
         (SELECT count(*) FROM fns, roles
           WHERE to_regprocedure(fns.f) IS NULL OR has_function_privilege(roles.r, to_regprocedure(fns.f), 'EXECUTE')) = 0
  UNION ALL
  -- Etat voulu en P1 : RPC FERMEE. En P2 (RPC ouverte), remplacer "= 0" par "= 2" et attendu par '2'.
  SELECT 7, 'fn_report_client_version : EXECUTE anon/authenticated (P1 : ferme)', '0',
         (SELECT count(*) FROM rpc, roles WHERE rpc.oid IS NOT NULL AND has_function_privilege(roles.r, rpc.oid, 'EXECUTE'))::text,
         (SELECT oid FROM rpc) IS NOT NULL
           AND (SELECT count(*) FROM rpc, roles WHERE has_function_privilege(roles.r, rpc.oid, 'EXECUTE')) = 0
  UNION ALL
  SELECT 8, 'SECURITY DEFINER : fn_write_audit_stmt et fn_report_client_version', '2',
         (SELECT count(*) FROM pg_proc WHERE prosecdef AND oid IN ((SELECT oid FROM trg), (SELECT oid FROM rpc)))::text,
         (SELECT count(*) FROM pg_proc WHERE prosecdef AND oid IN ((SELECT oid FROM trg), (SELECT oid FROM rpc))) = 2
  UNION ALL
  SELECT 9, 'search_path fige sur les 6 fonctions', '6',
         (SELECT count(*) FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(f) FROM fns UNION SELECT oid FROM rpc)
             AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%'))::text,
         (SELECT count(*) FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(f) FROM fns UNION SELECT oid FROM rpc)
             AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%')) = 6
  UNION ALL
  SELECT 10, 'lock_timeout=200ms sur fn_write_audit_stmt et fn_report_client_version', '2',
         (SELECT count(*) FROM pg_proc p WHERE p.oid IN ((SELECT oid FROM trg), (SELECT oid FROM rpc))
             AND 'lock_timeout=200ms' = ANY (p.proconfig))::text,
         (SELECT count(*) FROM pg_proc p WHERE p.oid IN ((SELECT oid FROM trg), (SELECT oid FROM rpc))
             AND 'lock_timeout=200ms' = ANY (p.proconfig)) = 2
  UNION ALL
  SELECT 11, 'cle primaire de t_write_audit contient classe', 'oui',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                            WHERE c.conrelid = to_regclass('public.t_write_audit') AND c.contype = 'p' AND a.attname = 'classe')
              THEN 'oui' ELSE 'non' END,
         EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                  WHERE c.conrelid = to_regclass('public.t_write_audit') AND c.contype = 'p' AND a.attname = 'classe')
  UNION ALL
  SELECT 12, '6 triggers 0006/0007 toujours actifs', '6',
         (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'O' AND tgname IN
            ('trg_t_cartes_status_guard', 'trg_t_users_sa_guard_ins', 'trg_t_users_sa_guard_upd',
             'trg_t_users_sa_guard_del', 'trg_t_user_roles_sa_guard_ins', 'trg_t_user_roles_sa_guard_upd'))::text,
         (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'O' AND tgname IN
            ('trg_t_cartes_status_guard', 'trg_t_users_sa_guard_ins', 'trg_t_users_sa_guard_upd',
             'trg_t_users_sa_guard_del', 'trg_t_user_roles_sa_guard_ins', 'trg_t_user_roles_sa_guard_upd')) = 6
)
SELECT n, verification, attendu, observe, CASE WHEN ok THEN 'OK' ELSE 'KO' END AS resultat
FROM chk ORDER BY n;
```

Résultat sur le dev le 2026-11-13 (après réapplication) : 12/12 `OK`.

**Ordre d'urgence (du plus doux au plus lourd)** — blocs complets en tête de
`0008_mesure_ecritures_cles.sql` :
1. **Interrupteur** (immédiat, réversible, aucun verrou de table) :
   `UPDATE public.t_write_audit_config SET enabled = false, updated_at = now() WHERE id = 1;`
   (réactivation : `enabled = true`). Désactivée, chaque écriture fait seulement une lecture de
   cette ligne.
2. **Débrancher les 24 triggers sans DROP** : `ALTER TABLE … DISABLE TRIGGER` dans
   `BEGIN; SET LOCAL lock_timeout = '3s'; … COMMIT;` (`ShareRowExclusiveLock`, court).
3. **Retour arrière complet (DROP), seulement hors heures** : `DROP TRIGGER` prend un
   `AccessExclusiveLock` sur la table métier (mesuré sur le dev) ; retirer 0009 avant 0008 ;
   même protection `lock_timeout`. Blocs prouvés sur le dev le 2026-11-13.

- **Couper la RPC 0009** (déjà fermée par défaut) :
  `REVOKE EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;`
  L'ouvrir seulement pour la preuve contrôlée de P1-1b (puis refermer aussitôt) et en P2
  (`GRANT EXECUTE … TO anon, authenticated`). Rejouer 0009 la referme.
- **Lire les compteurs** :
  ```sql
  SELECT jour, classe, table_name, op, jwt_role, claim_keys, client_info,
         nb_instructions, nb_lignes, derniere_vue
  FROM public.t_write_audit ORDER BY jour DESC, classe, table_name, op;
  ```
- **Lire les versions** :
  ```sql
  SELECT poste_key, app_version, key_kind, client_info, site_sync_id, last_seen_at, nb_reports
  FROM public.t_client_versions ORDER BY last_seen_at DESC;
  ```
- **Retour arrière complet** : blocs écrits en tête de chaque fichier (retirer 0009 avant
  0008, car 0009 utilise `fn_write_audit_classe`).
- **Limite connue de 0008** : si deux transactions se disputent la même ligne de compteur
  plus de 200 ms (`lock_timeout` de la fonction), le compteur de la seconde est perdu
  (avertissement Postgres, écriture métier inchangée). Sous-comptage possible, jamais de
  blocage ni d'erreur côté poste.

## 0010 : procédure de production (lecture des versions de postes)

0010 ne crée que deux fonctions en lecture seule : aucun trigger, aucune table, aucun verrou
sur une table métier. Pas besoin d'attendre la fin de journée, mais même méthode que 0008/0009.

**Étape 0 — vérification préalable, lecture seule.** Toutes les lignes `OK`, sinon ne rien
appliquer.

```sql
SELECT 1 AS n, '0009 en place (t_client_versions + fn_report_client_version)' AS verification,
       CASE WHEN to_regclass('public.t_client_versions') IS NOT NULL
             AND to_regprocedure('public.fn_report_client_version(text,text,text,text)') IS NOT NULL
            THEN 'OK' ELSE 'KO - ARRETER' END AS resultat
UNION ALL
SELECT 2, 'fonctions 0010 encore absentes (sinon : deja appliquee, rejouer est sans danger)',
       CASE WHEN to_regprocedure('public.fn_list_client_versions()') IS NULL
             AND to_regprocedure('public.fn_count_client_versions()') IS NULL
            THEN 'OK' ELSE 'DEJA PRESENTES' END
UNION ALL
SELECT 3, 'colonne sync_id presente dans t_sites et t_users',
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND column_name = 'sync_id'
                     AND table_name IN ('t_sites', 't_users')) = 2
            THEN 'OK' ELSE 'KO - ARRETER' END
ORDER BY 1;
```

**Étape 1 — appliquer.** Nouvel onglet du SQL Editor : `BEGIN;`, coller **tout**
`0010_lecture_versions_postes.sql`, `COMMIT;`, exécuter en une fois. Une erreur annule tout
(rien n'est créé) ; transmettre le message sans réessayer.

**Étape 2 — contrôle, lecture seule.** Toutes les lignes `OK`.

```sql
WITH f(sig) AS (VALUES ('public.fn_list_client_versions()'), ('public.fn_count_client_versions()')),
chk(n, verification, ok) AS (
  SELECT 1, '2 fonctions SECURITY DEFINER, STABLE, search_path fige',
         (SELECT count(*) FROM f JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
           WHERE p.prosecdef AND p.provolatile = 's'
             AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%')) = 2
  UNION ALL
  SELECT 2, 'EXECUTE anon et authenticated sur les 2 fonctions (ouvert jusqu''a P2)',
         (SELECT count(*) FROM f, (VALUES ('anon'), ('authenticated')) r(r)
           WHERE to_regprocedure(f.sig) IS NOT NULL
             AND has_function_privilege(r.r, to_regprocedure(f.sig), 'EXECUTE')) = 4
  UNION ALL
  SELECT 3, 'fn_report_client_version toujours FERMEE a anon/authenticated (avant la Release)',
         NOT has_function_privilege('anon', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE')
           AND NOT has_function_privilege('authenticated', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE')
  UNION ALL
  SELECT 4, 't_client_versions toujours illisible directement par anon/authenticated',
         NOT has_table_privilege('anon', 'public.t_client_versions', 'SELECT')
           AND NOT has_table_privilege('authenticated', 'public.t_client_versions', 'SELECT')
)
SELECT n, verification, CASE WHEN ok THEN 'OK' ELSE 'KO' END AS resultat FROM chk ORDER BY n;
```

Lecture de contrôle (SQL Editor) : `SELECT * FROM public.fn_count_client_versions();` puis
`SELECT * FROM public.fn_list_client_versions();` (tant qu'aucun poste n'envoie sa version, la
liste est vide ; les lignes `preuve-%` éventuelles sont comptées dans `nb_preuve`).

**Rappel, PAS MAINTENANT — juste avant la Release** qui embarque l'envoi de version
(`docs/PLAN_ECRAN_VERSIONS_POSTES.md`, étape 6) :

```sql
GRANT EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
```

Rejouer 0009 referme cette RPC (REVOKE final) : refaire le GRANT après tout rejeu de 0009.

**Retour arrière** (en tête du fichier 0010) : `BEGIN; SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.fn_list_client_versions(); DROP FUNCTION IF EXISTS
public.fn_count_client_versions(); COMMIT;` — l'écran affichera alors une erreur de lecture,
sans effet sur la synchronisation.

## 0007 : procédures manuelles (période transitoire)

Tant que l'application écrit `t_users` / `t_user_roles` avec la clé anon, le garde 0007
neutralise **aussi** les gestes légitimes qui touchent un SUPER ADMIN depuis un poste :
création (le compte arrive en quarantaine, `statut_actif = 0`), reset ou changement de mot
de passe ou de login d'un SUPER ADMIN (le cloud garde l'ancien hash/login), élévation,
rétrogradation, réactivation, suppression. Ils se rejouent à la main dans le **SQL Editor**
du projet (rôle `postgres`, non filtré par le garde). Remplacer les valeurs `<...>`.

**Attention, le poste qui a fait le geste est aussi concerné.** À la descente suivante des
comptes (redémarrage, « Télécharger les agents »), le poste recopie `statut_actif` et
`password_hash` depuis le cloud (`src/main/sync/users-sync.helper.ts:203`, `:310-318`) : un
SUPER ADMIN créé par ROOT redevient inactif, et un mot de passe réinitialisé par ROOT
reprend l'ancienne valeur, **y compris sur le poste qui les a faits**. Faire la procédure
SQL ci-dessous **avant** tout redémarrage du poste.

**Lire le journal du garde**

```sql
SELECT id, created_at, table_name, op, reason, login, sync_id, jwt_role, attempted
FROM public.t_security_guard_events
ORDER BY created_at DESC
LIMIT 100;
```

**Activer un SUPER ADMIN en quarantaine** (après avoir vérifié avec ROOT que la création
est légitime)

```sql
-- 1. Repérer le compte (journal + ligne)
SELECT created_at, login, sync_id, jwt_role, attempted
FROM public.t_security_guard_events
WHERE reason = 'SA_INSERT_QUARANTAINE'
ORDER BY created_at DESC;

SELECT id_user, login, role, statut_actif, site_id, created_at
FROM public.t_users
WHERE role = 'SUPER ADMIN'
ORDER BY created_at DESC;

-- 2. Activer (une seule ligne attendue : "UPDATE 1")
UPDATE public.t_users
SET statut_actif = 1, updated_at = now()
WHERE sync_id = '<SYNC_ID_DU_COMPTE>'
  AND role = 'SUPER ADMIN'
  AND statut_actif = 0;
```

**Reporter dans le cloud le hash d'un SUPER ADMIN depuis un poste** (après un reset ou un
changement de mot de passe fait sur ce poste)

1. Sur le poste où le mot de passe a été changé, lire la ligne dans la base SQLite locale
   (outil SQLite en lecture seule, application fermée) :
   ```sql
   SELECT sync_id, login, password_hash FROM t_users WHERE login = '<LOGIN_DU_SA>';
   ```
2. Dans le SQL Editor, vérifier que le format du hash copié ressemble à l'actuel (mêmes
   premiers caractères), sans afficher le hash entier :
   ```sql
   SELECT login, left(password_hash, 7) AS debut_hash, length(password_hash) AS longueur
   FROM public.t_users WHERE sync_id = '<SYNC_ID_DU_SA>' AND role = 'SUPER ADMIN';
   ```
3. Reporter le hash (une seule ligne attendue : "UPDATE 1") :
   ```sql
   UPDATE public.t_users
   SET password_hash = '<HASH_COPIE_DU_POSTE>', updated_at = now()
   WHERE sync_id = '<SYNC_ID_DU_SA>'
     AND role = 'SUPER ADMIN';
   ```

Le hash est un secret : ne jamais le coller dans un chat, un ticket, un commit ni le
Second-cerveau ; effacer l'onglet du SQL Editor après usage.

**Autres gestes** (élévation, rétrogradation, changement de login, suppression d'un SUPER
ADMIN) : même principe, `UPDATE` / `DELETE` ciblé par `sync_id` dans le SQL Editor.

**Retour arrière du garde** : immédiat et réversible
`UPDATE public.t_security_guard_config SET enabled = false, updated_at = now() WHERE id = 1;`
(réactivation : `enabled = true`) ; complet : `ALTER TABLE ... DISABLE TRIGGER` pour les
5 triggers listés en tête du fichier 0007.

**Vérification après application** : rejouer le test SQL sur le dev, puis faire un appel
REST réel avec la clé anon (ex. changement de nom d'un compte de test SUPER ADMIN du dev)
et contrôler dans le journal que `jwt_role` vaut `anon`.

## Limitation connue / travail restant

La Supabase CLI n'étant pas installée/configurée dans ce dépôt (pas de
`supabase init`, pas de projet lié via `supabase link`), l'application des
migrations reste **manuelle** pour l'instant : copier-coller le contenu du
fichier dans le SQL Editor de chaque projet Supabase (dev puis prod), ou
exécuter le fichier via `psql`/un client Postgres pointé sur la bonne base.

Une automatisation complète (`supabase db push` rejouant automatiquement les
migrations non appliquées sur un projet lié, avec table de suivi
`schema_migrations`) nécessiterait d'installer la CLI comme dépendance de
dev, de lancer `supabase init`, puis `supabase link` séparément pour chaque
projet (dev et prod ne peuvent pas être liés simultanément dans un seul
répertoire de travail — il faudrait soit deux profils/répertoires, soit
relier/délier alternativement). C'est un chantier distinct, volontairement
laissé hors du périmètre de cette mise en place initiale ; à valider
explicitement avec l'utilisateur avant d'être entrepris.
