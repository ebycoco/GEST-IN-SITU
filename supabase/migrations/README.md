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
- **`0011_hook_identite_claims.sql`** — chantier B, P1-5 : table `t_auth_identity` (compte Auth
  miroir → `t_users.sync_id`, `last_online_login_at` écrit seulement par service_role), fonction
  `fn_auth_identity_upsert` (service_role), hook `custom_access_token_hook` (SECURITY DEFINER,
  STABLE, EXECUTE `supabase_auth_admin` seulement ; claims `gis_*` liées à la personne et ids
  cloud ; refus 403 si compte inconnu, inactif, sans site hors SA, ou dernière connexion en ligne
  de plus de 30 jours, y compris au `token_refresh`) et fonctions `fn_jwt_sync_id`,
  `fn_jwt_site_id`, `fn_jwt_site_sync_id`, `fn_jwt_centre_id`, `fn_jwt_roles`,
  `fn_jwt_is_super_admin` (pour la RLS de P1-6). Aucune table métier ni politique existante
  touchée. **N'active pas le hook** (geste utilisateur, ci-dessous). Test :
  `supabase/tests/0011_hook_identite_claims.test.sql`. **Dev : appliquée le 2026-11-18**
  (`apply_migration` MCP, PostgreSQL 17.11, fichier inchangé : aucun écart de schéma) ; test
  20/20 concluants + cas 20 non concluant (le rôle `postgres` du MCP ne peut pas faire
  `SET ROLE supabase_auth_admin`, 42501 ; le droit EXECUTE de `supabase_auth_admin` est vérifié
  au catalogue, cas 0) ; contrôle 3/3 OK. Hook **non activé** dans Auth. **Production : NON
  appliquée.**
- **`0012_tentatives_connexion.sql`** — chantier B, P1-5 (C5) : table `t_login_attempts` (clé =
  SHA-256 du login normalisé, jamais le login en clair), `fn_login_check_and_record(login,
  'check'|'failure'|'success')` (5 échecs → 15 min, puis doublement, plafond 24 h ; oubli après
  24 h sans échec ; EXECUTE service_role seulement) et `fn_login_unblock(login)` (service_role,
  SQL Editor, ou authenticated porteur de `gis_is_super_admin` ; EXECUTE service_role seulement
  pour l'instant). **Dépend de 0011.** Test : `supabase/tests/0012_tentatives_connexion.test.sql`.
  **Dev : appliquée le 2026-11-18** (juste après 0011, fichier inchangé) ; test 13/13 ;
  non-régression rejouée le même jour : 0006 19/19, 0007 20/20, 0008 26/26, 0009 17/17,
  0010 14/14 (transactions annulées, aucun résidu). **Production : NON appliquée.**
- **Edge Function `supabase/functions/gis-login/index.ts`** (hors numérotation, chantier B P1-5c) —
  connexion en ligne : limite de tentatives (0012), bcrypt dans la fonction, compte Auth miroir
  `lower(sync_id)@users.gest-in-situ.invalid`, `fn_auth_identity_upsert` (0011), renvoie un
  `token_hash` que le poste échange lui-même par `verifyOtp` (Q3). **Dépend de 0011 et 0012.**
  **Dev : déployée le 2026-11-18** (outil MCP `deploy_edge_function`, `verify_jwt = false`,
  version 1), tests réels conformes et nettoyés (détail : `docs/PLAN_P1_CHANTIER_B.md`, P1-5).
  CORS : variable `GIS_ALLOWED_ORIGINS`, sinon serveurs locaux de développement. Hook toujours
  **non activé**. **Production : NON déployée** (geste utilisateur après P1-6 et audit agent-9 :
  tableau de bord Edge Functions ou outil MCP, avec `verify_jwt` désactivé).
- **`0013_rls_authenticated_par_site.sql`** — chantier B, P1-6 : 14 politiques **RESTRICTIVE TO
  authenticated** (`r13_*`) filtrees **par site** (Q4) a partir des claims du hook (0011) :
  `t_cartes.id_site`, `t_logs.site_id`, `t_user_presence.site_id`, `t_users.site_id`,
  `t_user_roles` (site du compte), `t_postes` (site du centre) en lecture et ecriture ;
  `t_sites` / `t_centres` lisibles par tout porteur des claims `gis_*`, ecriture par site.
  SUPER ADMIN (`gis_is_super_admin`) : tous les sites. **Echec ferme** : un jeton authenticated
  sans claims `gis_*` n'a acces a rien. `password_hash` illisible par authenticated
  (privileges de colonne ; ecriture toujours permise) ; TRUNCATE / TRIGGER / REFERENCES /
  MAINTAIN retires a authenticated sur ces 8 tables. **Aucun droit ni politique anon touche**
  (les postes actuels ecrivent en anon : inchange). **Dependance : 0011.** Test :
  `supabase/tests/0013_rls_authenticated_par_site.test.sql` (vrais `SET LOCAL ROLE`
  authenticated / anon / service_role). **Dev : appliquee le 2026-11-18** (MCP
  `apply_migration`) ; test 19/19 ; empreinte md5 des droits / politiques / colonnes / fonctions
  accessibles a anon identique avant et apres (206 elements) ; non-regression rejouee le meme
  jour : 0006 19/19, 0007 20/20, 0008 26/26, 0009 17/17, 0010 14/14, 0011 20/20 (+ cas 20 non
  concluant, comme avant), 0012 13/13 ; aucun residu. **Production : NON appliquee.**
  Depuis 0014, le test 0013 rejoue tel quel donnait 15/19 (ecarts **attendus** dus a 0014,
  voir section « 0014 » plus bas). **Test adapte le 2026-11-18** a l'empilement reel
  0013 + 0014 (+ 0015), sans retirer les `r14_*` : **19/19** sur le dev (detail section
  « 0015 » plus bas).
- **`0014_filtre_role_hierarchie.sql`** — chantier B, P1-6 (complement de 0013, decision de
  l'utilisateur du 2026-11-18) : 9 politiques **RESTRICTIVE TO authenticated** (`r14_*`,
  INSERT / UPDATE / DELETE seulement) qui filtrent **par role** les ecritures sur `t_sites`,
  `t_centres`, `t_postes`, alignees sur ce que l'application permet aujourd'hui :
  `t_sites` = SUPER ADMIN seulement ; `t_centres` = SUPER ADMIN ou `ADMINISTRATEUR_SITE` de
  **son** site ; `t_postes` = SUPER ADMIN ou `ADMINISTRATEUR_SITE` pour un centre de **son**
  site. `ADMIN_CENTRE` et `OPERATEUR_*` : aucune ecriture sur ces 3 tables. Role lu dans la
  claim `gis_roles` (role principal + secondaires, comme `verifyUserRole()`). **Lecture
  inchangee** (regles 0013). Echec ferme conserve. **Aucun droit ni politique anon touche.**
  **Dependances : 0011 et 0013** (le fichier s'arrete sinon). Test :
  `supabase/tests/0014_filtre_role_hierarchie.test.sql`. **Dev : appliquee le 2026-11-18**
  (MCP `apply_migration`, partie executable identique au fichier) ; test 17/17 (cas 16
  service_role concluant) ; empreinte anon identique avant / apres (206 elements, meme md5) ;
  non-regression rejouee le meme jour : 0006 19/19, 0007 20/20, 0008 26/26, 0009 17/17, 0010
  14/14, 0011 20/20 (+ cas 20 non concluant, comme avant), 0012 13/13, 0013 15/19 tel quel
  (ecarts attendus, detail plus bas) et 19/19 sans les politiques `r14_*` ; controles 7/7 OK ;
  aucun residu. **Production : NON appliquee.**
- **`0015_garde_sa_authenticated.sql`** — chantier B, decision Q6 (adaptation du garde 0007,
  fichier 0007 non modifie) : un appelant `authenticated` **SUPER ADMIN verifie** (claims
  `gis_*` valides, `gis_is_super_admin` et `gis_statut_actif` vrais, ET compte `t_users`
  encore actif et SUPER ADMIN au moment de l'ecriture) devient **fiable** pour 0007 ; trois
  triggers `trg_t_users_sa_guard_auth_*` lui appliquent les regles de l'application :
  mot de passe d'un **autre** SUPER ADMIN repris (ROOT seulement), `sync_id` d'un SUPER ADMIN
  repris, auto-desactivation reprise, auto-suppression ignoree ; creation, elevation, role
  secondaire SUPER ADMIN, login, retrogradation, desactivation / suppression d'un **autre** SA
  permis et journalises (`SA_AUTH_*`). **anon, authenticated sans claims, ADMINISTRATEUR_SITE,
  ADMIN_CENTRE, OPERATEUR_* : comportement 0007 inchange** (jamais creer / promouvoir un SA).
  `fn_sa_guard_caller_untrusted` remplacee (version 0007 + une ligne en tete). **Dependances :
  0007, 0011, 0013, 0014** (le fichier s'arrete sinon). Test :
  `supabase/tests/0015_garde_sa_authenticated.test.sql`. **Dev : appliquee le 2026-11-18**
  (MCP `apply_migration`, partie executable identique au fichier) ; test **16/16** ;
  empreinte anon identique avant / apres (206 elements, meme md5) ; non-regression detaillee
  section « 0015 ». **Production : NON appliquee.**
- **`0016_filtre_role_comptes.sql`** — chantier B, decision de l'utilisateur du 2026-11-18
  (option b) : filtre **par role** des ecritures `authenticated` sur `t_users` et
  `t_user_roles`, aligne sur l'application (`ASSIGNABLE_ROLES_BY_CREATOR`, `createUser`,
  `updateUser`, `deleteUser` / `hardDeleteUser`, `resetAgentPassword`, `updateSelfProfile`).
  Deux triggers `BEFORE ... FOR EACH ROW` (`trg_t_users_x16_filtre_role`,
  `trg_t_user_roles_x16_filtre_role`) actifs **seulement sous le role SQL `authenticated`**
  (`current_setting('role')`) ; SUPER ADMIN verifie (0015), anon, service_role, postgres :
  inchanges. Refus = 42501. **Aucun droit ni politique ajoute ; empreinte anon identique.**
  **Dependances : 0007, 0011, 0013, 0014, 0015** (le fichier s'arrete sinon). Test :
  `supabase/tests/0016_filtre_role_comptes.test.sql`. **Dev : appliquee le 2026-11-18** ;
  test **15/15** ; detail section « 0016 ». **Production : NON appliquee.**
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

## 0011 / 0012 : dev d'abord, activation du hook, retour arrière

Ordre : 0011 puis 0012, chacune en un seul bloc `BEGIN; <fichier> COMMIT;` (contrôle
`lock_timeout` en tête). Aucun trigger, aucun verrou sur une table métier ; 0011 pose une clé
étrangère vers `auth.users` (verrou court sur cette table). **Prod : seulement après P1-6 (0013),
l'Edge Function `gis-login` testée sur le dev et l'audit agent-9.**

**Dev** : appliquer 0011 et 0012, rejouer `supabase/tests/0011_*.test.sql` et `0012_*.test.sql`
(transactions annulées), puis 0006, 0007, 0008 (non-régression). **Fait le 2026-11-18** (voir
la liste plus haut) : 0011 et 0012 en place sur le dev, hook non activé.

**Activer le hook (geste utilisateur, tableau de bord, hors SQL)** : Authentication > Hooks
(chemin confirmé par la doc Supabase, `search_docs` du 2026-11-18 ; une page le nomme encore
« Hooks (Beta) ») > ajouter le hook « Custom Access Token » > type **Postgres**, schéma `public`,
fonction `custom_access_token_hook` > Enable. Le libellé exact du bouton n'est pas vérifié. Dev d'abord. Effet : toute émission de jeton Auth du projet
passe par le hook ; un utilisateur Auth sans ligne `t_auth_identity` est refusé (403). Les postes
actuels (clé anon / publishable, sans session Auth) ne sont **pas** concernés.

**Contrôle après application (lecture seule)** :

```sql
SELECT 'hook : EXECUTE supabase_auth_admin, ferme a anon/authenticated' AS verification,
       CASE WHEN has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
            THEN 'OK' ELSE 'KO' END AS resultat
UNION ALL
SELECT 't_auth_identity et t_login_attempts illisibles par anon/authenticated',
       CASE WHEN NOT has_table_privilege('anon', 'public.t_auth_identity', 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.t_auth_identity', 'SELECT')
             AND NOT has_table_privilege('anon', 'public.t_login_attempts', 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.t_login_attempts', 'SELECT')
            THEN 'OK' ELSE 'KO' END
UNION ALL
SELECT 'fonctions de tentatives reservees a service_role',
       CASE WHEN has_function_privilege('service_role', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.fn_login_check_and_record(text,text)', 'EXECUTE')
            THEN 'OK' ELSE 'KO' END;
```

**Retour arrière** : d'abord **désactiver le hook** dans le tableau de bord (sinon toute connexion
Auth échoue), puis les blocs écrits en tête de 0016, 0015, 0014, 0013, 0012 puis 0011 (retirer
0016, 0015, 0014, 0013 et 0012 avant 0011 : elles utilisent ses fonctions `fn_jwt_*`).

**Numérotation (mise à jour du 2026-11-18)** : l'adaptation du garde 0007 (décision Q6) devient
la migration **0015** (0014 = filtre par rôle). Le commentaire en tête du fichier 0013 (ligne
« adaptation = 0014, Q6 ») est resté tel quel, 0013 n'étant pas modifiée : il faut lire 0015.

## 0013 : politiques RESTRICTIVE TO authenticated (P1-6)

**Effet sur les postes actuels : aucun** (ils écrivent en anon ; une politique RESTRICTIVE ne
vise que les rôles qu'elle nomme). Effet sur authenticated : passe de « tout » (politique
`allow_all_operations_*`) à « son site », et à « rien » sans claims `gis_*`.

**Verrou** : `CREATE POLICY` prend un `AccessExclusiveLock` sur la table (mesuré sur le dev le
2026-11-18 : bloque aussi les lectures le temps de l'instruction), dont `t_cartes`. Les
`REVOKE` / `GRANT` ne prennent pas de verrou de table. En prod : hors heures de travail des
postes, en un seul bloc `BEGIN; <fichier 0013> COMMIT;` (le `SET LOCAL lock_timeout = '3s'`
en tête annule tout si un verrou n'est pas obtenu en 3 s ; rien n'est changé, réessayer plus
tard). Prérequis : 0011 appliquée (le fichier s'arrête sinon).

**Dev** : appliquer 0013, rejouer `supabase/tests/0013_*.test.sql` puis 0006 à 0012.
**Fait le 2026-11-18** (voir la liste plus haut).

**Contrôle après application (lecture seule)** :

```sql
SELECT '0013 : 14 politiques r13_* RESTRICTIVE TO authenticated seulement' AS verification,
       CASE WHEN (SELECT count(*) = 14 AND bool_and(permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[])
                    FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r13\_%')
            THEN 'OK' ELSE 'KO' END AS resultat
UNION ALL
SELECT '0013 : password_hash illisible par authenticated, toujours lisible par anon',
       CASE WHEN NOT has_column_privilege('authenticated', 'public.t_users', 'password_hash', 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.t_users', 'SELECT')
             AND has_column_privilege('anon', 'public.t_users', 'password_hash', 'SELECT')
            THEN 'OK' ELSE 'KO' END
UNION ALL
SELECT '0013 : anon garde SELECT/INSERT/UPDATE/DELETE sur t_cartes et t_users',
       CASE WHEN has_table_privilege('anon', 'public.t_cartes', 'SELECT,INSERT,UPDATE,DELETE')
             AND has_table_privilege('anon', 'public.t_users', 'SELECT')
             AND has_table_privilege('anon', 'public.t_users', 'INSERT')
             AND has_table_privilege('anon', 'public.t_users', 'UPDATE')
            THEN 'OK' ELSE 'KO' END;
```

Preuve « anon inchangé » plus forte (à lancer **avant** puis **après** 0013, les deux
empreintes doivent être identiques) :

```sql
SELECT md5(string_agg(x, '|' ORDER BY x)) AS empreinte_anon, count(*) AS n FROM (
 SELECT 'pol:'||tablename||':'||policyname||':'||permissive||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x
   FROM pg_policies WHERE schemaname='public' AND ('anon'=ANY(roles) OR 'public'=ANY(roles))
 UNION ALL
 SELECT 'priv:'||c.relname||':'||pr FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
  WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon',c.oid,pr)
 UNION ALL
 SELECT 'col:'||attrelid::regclass||':'||attname FROM pg_attribute
  WHERE attrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
    AND attnum>0 AND NOT attisdropped AND has_column_privilege('anon',attrelid,attnum,'SELECT')
 UNION ALL
 SELECT 'fn:'||p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')
) s;
```

**Retour arrière** : bloc écrit en tête du fichier 0013 (rend à authenticated l'état d'avant).
**Si 0014 est en place, retirer 0014 d'abord** (bloc en tête de 0014), puis 0013.

**À savoir pour P2 (client avec session authenticated)** : `select=*` et
`return=representation` sur `t_users` sont refusés (lister les colonnes, `return=minimal`) ;
un upsert qui réécrit `password_hash` via `EXCLUDED` est refusé (UPDATE simple ou RPC) ; un
lot qui touche une seule ligne d'un autre site échoue en entier ; les lignes sans site ne sont
visibles que du SUPER ADMIN.

## 0014 : filtre par rôle des écritures sur t_sites, t_centres, t_postes (P1-6)

**Effet sur les postes actuels : aucun** (anon non visé). Effet sur authenticated (en plus de
0013, les politiques RESTRICTIVE se cumulent par ET) :

| Table | INSERT / UPDATE / DELETE permis à | Source dans l'application (lecture du 2026-11-18) |
|---|---|---|
| `t_sites` | SUPER ADMIN seulement | `src/main/ipc/handlers.ts:4015`, `:4028`, `:4045` (`verifyUserRole(..., ['SUPER ADMIN'])`) |
| `t_centres` | SUPER ADMIN ; `ADMINISTRATEUR_SITE` pour un centre de son site | `handlers.ts:4160` (création, site forcé), `:4227` (modification), `:4315` (suppression) |
| `t_postes` | SUPER ADMIN ; `ADMINISTRATEUR_SITE` pour un poste d'un centre de son site | aucun handler de poste ; `createPoste` (`hierarchy.queries.ts:783`) n'est appelé nulle part ; postes supprimés avec leur centre (`:847`) ou leur site (`:372`) |

`ADMIN_CENTRE` et `OPERATEUR_*` : aucune écriture sur ces 3 tables (aucun handler ne le leur
permet ; route « sites » réservée à SUPER ADMIN / ADMINISTRATEUR_SITE, `App.tsx:339`). Rôle lu
dans `gis_roles` (principal + secondaires), même règle que `verifyUserRole()`
(`handlers.ts:76`). Lecture inchangée. Un UPDATE / DELETE non permis touche 0 ligne sans
erreur ; un INSERT non permis ou un déplacement hors périmètre lève 42501. Les suppressions en
cascade (site → centres → postes, `ON DELETE CASCADE`) ne passent pas par la RLS.

**Verrou** : `CREATE POLICY` = `AccessExclusiveLock` court sur `t_sites`, `t_centres`,
`t_postes` (pas `t_cartes`). Prod : un seul bloc `BEGIN; <fichier 0014> COMMIT;`, de
préférence dans la même fenêtre que 0013 ; prérequis contrôlés en tête (0011 et les 14
politiques `r13_*`, sinon arrêt).

**Dev** : **fait le 2026-11-18** (voir la liste plus haut).

**Effet sur le test 0013** (attendu, le fichier 0013 et son test ne sont pas modifiés) : son
« agent A » est un opérateur (`OPERATEUR_RECHERCHE` + `OPERATEUR_VERIFICATION`). Avec 0014,
il ne crée plus de poste ni de centre (cas 5 : 42501), ne modifie plus la ligne de son site
(cas 6 : 0 ligne), et son déplacement de poste vers un centre B passe de 42501 à 0 ligne
(cas 8 : toujours refusé) ; le cas 15 compte alors 2 lignes de référence de moins (seuil 15,
obtenu 14 ; écritures anon toutes acceptées). Test 0013 rejoué avec les politiques `r14_*`
retirées dans la même transaction annulée : 19/19. **Mise à jour du 2026-11-18** : le test
0013 a depuis été adapté à l'empilement réel (19/19 avec les `r14_*` en place, voir section
« 0015 ») ; le fichier de migration 0013 reste inchangé.

**Contrôle après application (lecture seule)** :

```sql
SELECT '0014 : 9 politiques r14_* RESTRICTIVE TO authenticated (3 INSERT, 3 UPDATE, 3 DELETE) sur t_sites/t_centres/t_postes' AS verification,
       CASE WHEN (SELECT count(*) = 9
                         AND bool_and(permissive = 'RESTRICTIVE' AND roles = ARRAY['authenticated']::name[]
                                      AND tablename IN ('t_sites','t_centres','t_postes')
                                      AND cmd IN ('INSERT','UPDATE','DELETE'))
                         AND count(DISTINCT tablename || cmd) = 9
                    FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r14\_%')
            THEN 'OK' ELSE 'KO' END AS resultat;
```

Puis l'empreinte anon (requête de la section 0013), avant et après : identique.

**Retour arrière** : bloc écrit en tête du fichier 0014 (rend aux écritures authenticated le
seul filtre par site de 0013).

**À savoir pour P2** : une écriture de centre mise en file (`t_outbox`) par un administrateur
puis envoyée sous la session d'un autre agent du même poste serait refusée (à traiter avec
`actor_sync_id`, Q8) ; `sync:forceCentres` (`handlers.ts:7648`) n'a pas de garde de rôle côté
poste : sous session authenticated, un non-administrateur qui le déclenche serait refusé.

## 0015 : garde SUPER ADMIN pour les sessions authenticated (Q6, avant P2)

**Effet sur les postes actuels : aucun** (ils écrivent en anon ; pour anon, le code de
`fn_sa_guard_caller_untrusted` est le même qu'en 0007 et les nouveaux triggers ne font rien).
Effet sur authenticated : seul un SUPER ADMIN **vérifié** (claims `gis_*` valides + compte
encore actif et SUPER ADMIN dans `t_users` / `t_user_roles`) sort de la neutralisation 0007 ;
un jeton SUPER ADMIN émis avant une désactivation ou une rétrogradation (jusqu'à 1 h) redevient
non fiable dès l'écriture suivante.

| Appelant | Gestes sur un compte SUPER ADMIN | Source dans l'application (lecture du 2026-11-18) |
|---|---|---|
| anon, authenticated sans claims `gis_*` | inchangé (0007) | — |
| `ADMINISTRATEUR_SITE`, `ADMIN_CENTRE`, `OPERATEUR_*` | inchangé (0007) : création en quarantaine, élévation annulée, rôle SA refusé ; comptes de leur site seulement (RLS 0013) | `users.queries.ts:22-35` (rôles attribuables), `:93-102` (cible SA interdite) |
| SUPER ADMIN vérifié | création, élévation, rôle secondaire SA, login, rétrogradation, (dés)activation et suppression d'un **autre** SA : permis | `handlers.ts:3588` (`users:create`), `users.queries.ts:23-27`, `:705`, `:1008`, `:1090` |
| SUPER ADMIN vérifié | mot de passe d'un **autre** SA : repris (ROOT seulement) ; le sien : permis | `users.queries.ts:729-741`, `:1229-1240` |
| SUPER ADMIN vérifié | `sync_id` d'un SA : repris ; se désactiver : repris ; se supprimer : ignoré | `users.queries.ts:636-640`, `:665-668` |

ROOT (session locale `id 999999`, sans compte cloud) n'a pas de session authenticated : ses
gestes sur un SUPER ADMIN restent la procédure manuelle ci-dessous (section « 0007 »).

**Verrou** : `CREATE TRIGGER` = `ShareRowExclusiveLock` court sur `t_users` seulement. Prod :
un seul bloc `BEGIN; <fichier 0015> COMMIT;` (prérequis 0007, 0011, 0013 et 0014 contrôlés en
tête, `lock_timeout` 3 s).

**Dev : fait le 2026-11-18** (agent-4), résultats sur l'empilement réel 0006-0015 :
0015 **16/16** ; 0013 adapté **19/19** ; 0014 **17/17** ; 0007 **20/20** ; 0006 **19/19** ;
0008 **26/26** ; 0009 **17/17** ; 0010 **14/14** ; 0011 **20/20** (+ cas 20 non concluant,
comme avant) ; 0012 **13/13** ; contrôles du README **8/8** (7 existants + celui de 0015).
Chaque test exécuté dans une transaction qui se termine par une erreur volontaire (rapport des
cas) : tout est annulé. Aucun résidu : empreinte anon (`a4212a8a…`, 206 éléments), empreinte
de toutes les politiques, journal 0007 (16 lignes), empreinte de `t_write_audit` et
comptages des tables métier identiques avant / après.

**Test 0013 adapté (2026-11-18)** : tables métier (`t_cartes`, `t_logs`, `t_users`,
`t_user_roles`, `t_user_presence`) toujours testées avec l'opérateur du site A ; écritures de
hiérarchie (`t_centres`, `t_postes`) sur son site **et** hors site testées avec un
`ADMINISTRATEUR_SITE` du site A (son rôle l'autorise, donc un refus hors site prouve le filtre
**par site** de 0013) ; la ligne de son site dans `t_sites` n'est modifiable ni par
l'opérateur ni par l'admin de site (0 ligne, attente ajustée à 0014) ; l'opérateur ne crée ni
poste ni centre (42501). 19 cas, même numérotation.

**Contrôle après application (lecture seule)** :

```sql
SELECT '0015 : 3 triggers auth + 5 triggers 0007 actifs, garde actif, fonctions fermees' AS verification,
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.t_users'::regclass AND NOT tgisinternal AND tgenabled = 'O'
                   AND tgname IN ('trg_t_users_sa_guard_auth_ins','trg_t_users_sa_guard_auth_upd','trg_t_users_sa_guard_auth_del',
                                  'trg_t_users_sa_guard_ins','trg_t_users_sa_guard_upd','trg_t_users_sa_guard_del')) = 6
             AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.t_user_roles'::regclass AND NOT tgisinternal AND tgenabled = 'O'
                   AND tgname IN ('trg_t_user_roles_sa_guard_ins','trg_t_user_roles_sa_guard_upd')) = 2
             AND (SELECT enabled FROM public.t_security_guard_config WHERE id = 1)
             AND NOT has_function_privilege('anon', 'public.fn_sa_guard_caller_sa_auth()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.fn_sa_guard_caller_sa_auth()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.fn_t_users_sa_guard_auth()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.fn_t_users_sa_guard_auth()', 'EXECUTE')
             AND (SELECT prosrc LIKE '%fn_sa_guard_caller_sa_auth%' FROM pg_proc WHERE oid = 'public.fn_sa_guard_caller_untrusted()'::regprocedure)
            THEN 'OK' ELSE 'KO' END AS resultat;
```

Puis l'empreinte anon (requête de la section 0013), avant et après : identique.

**Lire les gestes SUPER ADMIN authentifiés** : même requête que « Lire le journal du garde »
(section 0007), raisons `SA_AUTH_CREATION`, `SA_AUTH_ELEVATION`, `SA_AUTH_MODIF:<colonnes>`,
`SA_AUTH_NEUTRALISE:<colonnes>`, `SA_AUTH_SUPPRESSION`, `SA_AUTH_AUTO_SUPPRESSION_IGNOREE`,
`SA_AUTH_REPLI_FERME:<code>` (jamais de hash).

**Retour arrière** : bloc écrit en tête du fichier 0015 (supprime les 3 triggers et les 2
fonctions ajoutées, remet `fn_sa_guard_caller_untrusted` dans sa version 0007). Coupure
immédiate de tout le garde (0007 compris) : interrupteur `t_security_guard_config`.

**À savoir pour P2** : un upsert client d'un compte SA qui réécrit `password_hash` reste refusé
par 0013 (lecture d'`EXCLUDED`) ; une écriture de compte mise en file par un SUPER ADMIN puis
envoyée sous la session d'un autre agent du poste serait neutralisée (à traiter avec
`actor_sync_id`, Q8).

## 0016 : filtre par rôle des écritures de comptes (t_users, t_user_roles)

**Effet sur les postes actuels : aucun** (ils écrivent en anon ; le filtre ne se déclenche que si
l'instruction s'exécute sous le rôle SQL `authenticated`, `current_setting('role')`, comme une
politique « TO authenticated » ; une session postgres / service_role avec des claims simulées
n'est pas filtrée). SUPER ADMIN vérifié (0015) : non filtré. Refus : erreur 42501 (message
générique « 0016 : ecriture refusee (...) »), jamais de neutralisation silencieuse, sauf
l'effacement d'un rôle non attribuable (voir tableau).

| Appelant authenticated | Permis (sinon 42501) | Source dans l'application (lecture du 2026-11-18) |
|---|---|---|
| sans claims `gis_*` valides, ou jeton SUPER ADMIN non vérifié en base | rien sur `t_users` / `t_user_roles` | échec fermé (D-EF) |
| agent sans rôle d'administration | **sa propre ligne** `t_users` seulement : `nom_user`, `prenom_user`, `email`, `telephone`, `password_hash`, `updated_at` (+ `login` si son rôle **principal** est `ADMINISTRATEUR_SITE`) ; rien d'autre, aucune écriture `t_user_roles` | `users.queries.ts:1297-1388` (`updateSelfProfile`, colonnes `:1340`, login `:1323-1326`) ; `handlers.ts:3588`, `:3635` (création / modification réservées aux 3 rôles d'administration) |
| `ADMIN_CENTRE` (rôle le plus haut des `gis_roles`) | créer un compte de **son** centre avec un rôle `OPERATEUR_*` ; modifier un agent de son centre qui ne détient ni `ADMINISTRATEUR_SITE` ni `ADMIN_CENTRE` (mot de passe, statut 0/1, nom, contact, login, rôle `OPERATEUR_*`) ; rôles `OPERATEUR_*` de ces agents ; jamais supprimer un compte | `users.queries.ts:22-35`, `:296`, `:714-726`, `:744-761`, `:1002-1004`, `:1084-1086` |
| `ADMINISTRATEUR_SITE` | créer un compte de son site (`ADMIN_CENTRE` ou `OPERATEUR_*`, centre de son site ou aucun) ; modifier / désactiver / supprimer un compte de son site qui ne détient pas SUPER ADMIN ; rôle principal changé seulement vers un rôle attribuable ou déjà détenu en secondaire ; jamais son propre statut à la baisse ni sa propre suppression ; site et `sync_id` figés | `users.queries.ts:22-35`, `:295-303`, `:322`, `:636-640`, `:698-711`, `:744-787`, `:999-1018`, `:1081-1100`, `:1209-1240` |
| tous (non SA) sur `t_user_roles` | INSERT d'un rôle attribuable, ou déjà détenu (ligne identique existante = upsert sans effet, ou rôle principal du compte) ; DELETE d'un rôle attribuable ; **DELETE d'un rôle non attribuable : ignoré sans erreur (ligne conservée)** ; DELETE d'une ligne dont le compte n'existe plus (cascade) : permis | cycle « tout effacer puis réinsérer » de l'application : `users.queries.ts:888-895`, `:957-973`, `outbox.service.ts:697`, `:750` ; rôle masqué renvoyé tel quel : `AgentsPage.tsx:76-85`, `:563-566`, `users.queries.ts:744-747` |

Niveau d'administration = le plus haut rôle de `gis_roles` (principal + secondaires) : la
personne peut prendre n'importe lequel de ses rôles comme rôle actif (`auth:setActiveRole`,
`handlers.ts:405-417`), le JWT ne porte pas de rôle actif ; même lecture que 0014.

**Verrou** : `CREATE TRIGGER` = `ShareRowExclusiveLock` court sur `t_users` et `t_user_roles`.
Prod : un seul bloc `BEGIN; <fichier 0016> COMMIT;` (prérequis 0007, 0011, 0013, 0014, 0015
contrôlés en tête, `lock_timeout` 3 s).

**Dev : fait le 2026-11-18** (agent-4). Deux passes `apply_migration` : le fichier, puis un
correctif de `fn_r16_niveau` seule (`0016_filtre_role_comptes_niveau_role_sql`, déclenchement
par le rôle SQL au lieu de la seule claim `role`, découvert en rejouant le test 0008 : son cas
8 écrit `t_users` en postgres avec des claims `authenticated` simulées). Corps des 6 fonctions
identiques au fichier (md5 de `prosrc`). Résultats sur l'empilement réel 0006-0016 :
0016 **15/15** ; 0006 **19/19** ; 0007 **20/20** ; 0008 **26/26** ; 0009 **17/17** ; 0010
**14/14** ; 0011 **20/20** (+ cas 20 non concluant, comme avant) ; 0012 **13/13** ; 0013
**adapté 19/19** ; 0014 **17/17** ; 0015 **adapté 16/16** (tel quel : 11/16, écarts attendus
ci-dessous) ; contrôles du README **25/25** (12 de 0008/0009, 4 de 0010, 3 de 0011, 3 de 0013,
1 de 0014, 1 de 0015, 1 de 0016). Chaque test exécuté dans une transaction terminée par une
erreur volontaire (rapport des cas) : tout est annulé. Aucun résidu : empreinte anon
(`a4212a8a…`, 206 éléments), empreinte des politiques (34), empreinte des triggers hors 0016
(33), journal 0007 (16 lignes, id max 34), empreinte de `t_write_audit` (14 lignes),
comptages des 12 tables (tous 0), `auth.users` 0, aucune fonction d'aide `_t1x_` restante :
identiques avant / après.

**Tests 0013 et 0015 adaptés (2026-11-18)** : un opérateur ne crée plus de compte ni de rôle
(0013 cas 5 : création faite par l'`ADMINISTRATEUR_SITE` A) ; les refus hors site sur
`t_users` / `t_user_roles` viennent aussi de 0016 (code 42501 attendu, plus le texte « rls »,
0013 cas 7 et 0015 cas 7) ; créer un SUPER ADMIN, modifier un compte SUPER ADMIN de son site
ou écrire avec un jeton SUPER ADMIN non vérifié sont refusés en 42501 au lieu d'être
neutralisés par 0007 (0015 cas 5, 6, 12 ; cas 8 : SA en quarantaine créé par postgres). Les
fichiers de migration 0013 et 0015 ne sont pas modifiés.

**Contrôle après application (lecture seule)** :

```sql
SELECT '0016 : 2 triggers x16 actifs (BEFORE ROW I/U/D), 6 fonctions fermees, triggers SECURITY DEFINER, aucune politique ajoutee' AS verification,
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND tgtype = 31
                   AND ((tgrelid = 'public.t_users'::regclass AND tgname = 'trg_t_users_x16_filtre_role')
                     OR (tgrelid = 'public.t_user_roles'::regclass AND tgname = 'trg_t_user_roles_x16_filtre_role'))) = 2
             AND (SELECT count(*) FROM (VALUES ('public.fn_r16_niveau()'), ('public.fn_r16_roles_attribuables(text)'),
                                               ('public.fn_r16_detient(text,text)'), ('public.fn_r16_refus(text)'),
                                               ('public.fn_t_users_filtre_role()'), ('public.fn_t_user_roles_filtre_role()')) f(sig),
                                       (VALUES ('anon'), ('authenticated')) r(r)
                   WHERE to_regprocedure(f.sig) IS NULL OR has_function_privilege(r.r, to_regprocedure(f.sig), 'EXECUTE')) = 0
             AND (SELECT count(*) FROM pg_proc WHERE prosecdef
                   AND oid IN ('public.fn_t_users_filtre_role()'::regprocedure, 'public.fn_t_user_roles_filtre_role()'::regprocedure)) = 2
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'r16\_%') = 0
            THEN 'OK' ELSE 'KO' END AS resultat;
```

Puis l'empreinte anon (requête de la section 0013), avant et après : identique.

**Coupure immédiate** (réversible) : `ALTER TABLE ... DISABLE TRIGGER` des 2 triggers, dans
`BEGIN; SET LOCAL lock_timeout = '3s'; ... COMMIT;`. **Retour arrière complet** : bloc écrit en
tête du fichier 0016 (à retirer avant 0015 / 0014 / 0013).

**À savoir pour P2** : une écriture de compte mise en file par un administrateur puis envoyée
sous la session d'un autre agent du poste serait refusée (`actor_sync_id`, Q8) ;
`sync:forceAgents` (`handlers.ts:6327-6341`, sans garde de rôle côté poste) renvoie comptes
et rôles du site : sous la session d'un non-administrateur, refusé ; la règle « dernier
administrateur actif du site » (`users.queries.ts:648-663`) n'est pas reprise côté serveur ;
un administrateur rétrogradé garde ses droits jusqu'à l'expiration de son jeton (1 h), comme
0013 / 0014 ; un `ADMINISTRATEUR_SITE` ne peut pas retirer à un collègue un rôle qu'il ne peut
pas attribuer (`ADMINISTRATEUR_SITE`) : l'écran ne le propose pas, seul un appel IPC forgé le
faisait côté poste.

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
