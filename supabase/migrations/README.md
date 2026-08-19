# Migrations Supabase — GEST-IN-SITU

## Pourquoi ce dossier existe

Jusqu'au 19/08/2026, `supabase_schema.sql` (racine du dépôt) était le seul document
décrivant le schéma Supabase/PostgreSQL, mais **rien ne le rejouait jamais**
automatiquement sur les deux projets Supabase du projet :

| Projet | Ref | Usage |
|---|---|---|
| Dev/Staging | `zddibqgutigwxjwbojmn` | tests e2e-cloud (`allowRealSync: true`), aucune donnée citoyenne réelle |
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
   projets** : dev/staging (`zddibqgutigwxjwbojmn`) **puis** production
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
