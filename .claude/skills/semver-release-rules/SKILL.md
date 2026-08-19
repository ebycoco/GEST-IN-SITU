---
name: semver-release-rules
description: Règles d'incrémentation SemVer (PATCH/MINOR/MAJOR) de GEST-IN-SITU avec exemples concrets propres au projet, et le protocole de mise à jour des 4 fichiers (package.json, schema.ts, CHANGELOG.md, release-notes.md) à chaque cycle de release. À charger par agent-11-release-manager lors d'un cycle de versioning, ou en lecture par agent-7-release-master pour anticiper le bump attendu.
---

# Règles SemVer & protocole de versioning — GEST-IN-SITU

Déclenché **uniquement** quand l'utilisateur décide explicitement de lancer
`npm run build:win` (cf. `CLAUDE.md` §8) — jamais à chaque commit
intermédiaire. La source de vérité prioritaire pour le contenu du cycle est
le brouillon déjà accumulé en tête de `release-notes.md` (en-tête
`# GEST-IN-SITU — Prochaine version (non publiée)`), croisé avec `git log`
pour vérifier qu'aucune entrée n'a été oubliée dans le brouillon.

## Règles d'incrémentation

1. **PATCH (+0.0.1)** — Correctifs & ajustements météo terrain : tout bug
   fix, ajustement d'IHM, mise en page React, style CSS, textes, modaux
   d'information (ex: preuve de retrait), ou optimisation n'impactant pas
   la structure de données.
2. **MINOR (+0.1.0)** — Nouvelles fonctionnalités rétrocompatibles : ajout
   d'une nouvelle vue applicative, d'un nouveau flux métier non destructif,
   ou introduction d'une migration SQLite **additive** dans
   `src/main/database/`.
3. **MAJOR (+1.0.0)** — Modifications structurelles majeures : toute
   modification brisant la compatibilité descendante (refonte totale
   d'architecture, réécriture destructive du moteur de synchronisation
   Supabase/SQLite, suppression ou altération de clés primaires/étrangères
   existantes).

## Règle "STOP & WARN" — incrémentation de schéma BDD

Si une modification implique une montée de `SCHEMA_VERSION` (migration
SQLite dans `src/main/database/`) ou une rupture de compatibilité : ne pas
fixer le numéro de version, avertir l'utilisateur que "cette mise à jour
modifie SCHEMA_VERSION à [NouveauNuméro], un script de migration
rétrocompatible est indispensable pour ne pas corrompre les BDD SQLite des
centres en production", et consigner l'alerte dans le rapport final plutôt
que d'attendre une réponse en cours d'exécution.

## Protocole de mise à jour des fichiers cibles

Une fois la nouvelle version validée :

- **`package.json`** : incrémenter la clé `"version": "X.Y.Z"`.
- **`src/main/database/schema.ts`** : s'assurer que `SCHEMA_VERSION` (ou la
  variable cible) est strictement alignée avec le numéro des migrations de
  la version.
- **`CHANGELOG.md`** : insérer en tête du fichier une nouvelle section
  structurée selon la norme [Keep a Changelog], en français, en reprenant
  le contenu déjà rédigé dans le brouillon `release-notes.md` (pas une
  réécriture depuis zéro), sous ces trois rubriques :
  - 🚀 Nouveautés & Ergonomie (`feat`)
  - 🛠️ Corrections & Sécurité (`fix`)
  - ⚡ Performances & Optimisations (`perf` / `refactor`)
- **`release-notes.md`** : renommer l'en-tête
  `# GEST-IN-SITU — Prochaine version (non publiée)` en
  `# GEST-IN-SITU — Release vX.Y.Z` avec la date réelle, contenu déjà
  rédigé conservé (légères retouches de forme uniquement). **Après
  confirmation de la version par l'utilisateur**, réinitialiser le fichier
  à un nouveau brouillon vide pour amorcer le cycle suivant — ne jamais le
  laisser dans l'état "Release vX.Y.Z" une fois le cycle suivant entamé.

## Validation & rapport final

Après chaque mise à jour de version ou de documentation :
1. `npx tsc --noEmit` — validation systématique, 0 erreur tolérée.
2. Rapport de release synthétique en français : numéro de version
   précédent et nouveau (X.Y.Z), statut de `SCHEMA_VERSION`, extrait du
   `CHANGELOG.md` généré, confirmation `tsc` à 0 erreur.
