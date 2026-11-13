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
  `supabase/tests/0008_mesure_ecritures_cles.test.sql`. **Dev : appliquée le 2026-11-13.
  Production : non appliquée.**
- **`0009_versions_postes.sql`** — table `t_client_versions` (une ligne par poste, illisible
  par anon) + RPC `fn_report_client_version(poste_key, app_version, user_sync_id, site_sync_id)`
  ouverte à anon/authenticated, paramètres bornés, renvoie seulement un booléen ; la classe de
  clé est calculée côté serveur. **Dépend de 0008.** Aucun appel côté poste avant P2. Test :
  `supabase/tests/0009_versions_postes.test.sql`. **Dev : appliquée le 2026-11-13.
  Production : non appliquée.**
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
   Editor du projet prod, exécuter, puis faire les vérifications en lecture indiquées en tête
   du fichier. **Ne jamais exécuter un fichier `supabase/tests/*` en prod.**
3. Mettre à jour la ligne « Application » en tête du fichier et ce README.

## 0008 / 0009 : interrupteur, lecture, retour arrière

- **Couper la mesure 0008 (immédiat, sans perte, réversible)** :
  `UPDATE public.t_write_audit_config SET enabled = false, updated_at = now() WHERE id = 1;`
  (réactivation : `enabled = true`). Désactivée, chaque écriture fait seulement une lecture de
  cette ligne (les tables de transition restent capturées par Postgres).
  Plus radical, sans DROP : `ALTER TABLE public.<table> DISABLE TRIGGER trg_wa_<table>_ins;`
  (idem `_upd`, `_del`).
- **Couper la RPC 0009** : `REVOKE EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;`
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
