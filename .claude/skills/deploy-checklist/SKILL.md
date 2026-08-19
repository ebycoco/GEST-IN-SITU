---
name: deploy-checklist
description: Checklist de pré-déploiement GO/NO-GO de GEST-IN-SITU (7 points : environnement, nettoyage, versioning, purge BDD, sécurité, auto-updater, schéma Supabase prod) et format du tableau récapitulatif officiel. À charger avant tout audit de conformité final pré-release (agent-12-deploy-validator), ou en lecture par agent-7-release-master pour connaître les critères que l'audit va appliquer.
---

# Checklist de déploiement GEST-IN-SITU

Référence de la Checklist de Référence appliquée par `agent-12-deploy-validator`
à chaque audit de conformité pré-release. Contenu extrait tel quel de son
prompt système pour être chargé à la demande plutôt qu'à chaque invocation.

## Les 7 points à vérifier systématiquement

1. **ENVIRONNEMENT** : configuration `.env` de production active, clés API
   sécurisées, URLs de production Supabase/OpenRouter configurées.
2. **NETTOYAGE** : aucun `console.log` actif ou verbeux en production, aucun
   code de debug résiduel.
3. **VERSIONING & COMPILATION** : version dans `package.json` incrémentée par
   `agent-11-release-manager`, `SCHEMA_VERSION` aligné, compilation
   `npx tsc --noEmit` à 0 erreur.
4. **PURGE BDD** : aucune base `.sqlite` de développement, aucune donnée de
   test ni fichier de log temporaire inclus dans le packaging.
5. **SÉCURITÉ & ROBUSTESSE** : Single Instance Lock activé (empêche le
   double lancement), hachage sécurisé (bcrypt), contrôle d'accès IPC (RBAC)
   opérationnel.
6. **AUTO-UPDATER** : configuration GitHub (`ebycoco/GEST-IN-SITU`) vérifiée
   dans `electron-builder.yml` avec `release-notes.md` valide.
7. **SCHÉMA SUPABASE (Prod)** : toute colonne ajoutée par une migration
   locale (`schema.ts`) depuis la dernière release publiée et référencée
   dans un chemin de synchronisation (`payload-mapper.ts`, `upstream.ts`,
   `outbox.service.ts`, `upload-worker.js`, `download-worker.js`) doit
   exister sur la table correspondante de l'instance Supabase de
   **production** — sinon toute synchronisation montante utilisant cette
   colonne échoue silencieusement ou en bloc (rejet PostgREST "colonne
   inconnue").

   **Méthode** : pour chaque colonne candidate identifiée, exécuter une
   requête `SELECT <colonne> FROM <table> LIMIT 1` en lecture seule via un
   script Node ponctuel (`@supabase/supabase-js`, clé `anon` du `.env`
   local déjà utilisée par l'application — jamais d'écriture, jamais de
   DDL). Une erreur "column does not exist" signale une colonne manquante.
   Si une colonne manque, marquer **NO-GO** et fournir le script
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` correspondant, à exécuter
   manuellement par l'utilisateur via le SQL Editor Supabase (aucun
   mécanisme de migration Supabase versionné n'existe dans ce dépôt — voir
   `CLAUDE.md` §8 et les avertissements déjà présents dans
   `release-notes.md`).

## Règle "STOP & WARN" spécifique à cet audit

Si l'audit détecte des anomalies dans les fichiers de configuration de
production (`.env`, `electron-builder.yml`, `package.json`, `schema.ts`) :
marquer immédiatement **NO-GO**, avertir l'utilisateur et
`agent-7-release-master` avec le point précis en cause, et indiquer la
correction minimale et étanche à effectuer avant tout ré-audit.

## Tableau récapitulatif officiel (obligatoire en fin de rapport)

| Catégorie | Statut | Note / Remarque |
| :--- | :---: | :--- |
| **Technique & Typage** | [GO / NO-GO] | *0 erreur tsc, Single Instance Lock, Nettoyage logs* |
| **Sécurité & Accès** | [GO / NO-GO] | *Secrets .env, RBAC IPC, Hachage passwords* |
| **Bases de Données & Purge** | [GO / NO-GO] | *Purge .sqlite dev, alignement SCHEMA_VERSION* |
| **Installation & Auto-Update** | [GO / NO-GO] | *Config electron-builder, repo GitHub, release-notes* |
| **Schéma Supabase (Prod)** | [GO / NO-GO] | *Colonnes locales récentes présentes côté Supabase prod* |
| **FINAL** | **[GO / NO-GO]** | **Feu vert ou Blocage officiel** |

Si le statut FINAL est "NO-GO" : lister précisément les To-Do prioritaires
à corriger par `agent-3-coder`, `agent-7-release-master` ou
`agent-11-release-manager` avant le prochain ré-audit.
