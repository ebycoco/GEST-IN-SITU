# GEST-IN-SITU — Release v2.14.0

> **Date de publication :** 13 août 2026
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire
> **SCHEMA_VERSION :** 66 (inchangé, aucune migration ce cycle)

## 🚨 Sécurité (Critique)

- **7 fuites P0 de cloisonnement centre sur le portail ADMIN_CENTRE** (jusque-là jamais audité) : un ADMIN_CENTRE pouvait consulter les données d'autres centres — y compris des informations personnelles (téléphone, numéro CMU) — via une recherche 100% normale, sans forgeage d'appel technique. Les 7 points d'entrée concernés sont corrigés. Corrige au passage un bug de suppression de journal qui ciblait la mauvaise table.

## 🚀 Nouveautés & Ergonomie

- **Portail ADMIN_CENTRE : nouvel onglet "Escalades Résolues"** : quand un ADMIN_CENTRE escalade un signalement d'absence de carte au site, il peut désormais suivre ce qu'il en advient, au lieu de perdre toute visibilité une fois l'escalade envoyée.
- Correctif associé : une carte déclarée définitivement perdue restait invisible pour l'opérateur d'origine — corrigé.

## 🛠️ Corrections & Fiabilité

- **Propagation cloud du cycle signalement/escalade/résolution d'absence entre postes distincts** (chantier le plus important de ce cycle) : le cycle ne se propageait en réalité jamais correctement d'un poste à un autre. Plusieurs colonnes manquantes sur le schéma Supabase et plusieurs couches de code (envoi et réception) omettaient silencieusement des champs métier clés. Corrigé et validé de bout en bout entre deux postes réels.
- **Compteur "Télécharger N cartes depuis le Cloud"** ne redescendait jamais à 0 après un téléchargement complet — corrigé, avec rafraîchissement automatique toutes les 3 minutes pour refléter les nouvelles cartes ajoutées par un autre poste.

## ⚡ Performances

- **Bouton "Purger les cartes locales de ce PC"** figeait l'application pendant environ 30 secondes sur un volume réel de cartes — ramené à quelques centaines de millisecondes pour l'essentiel de l'opération.

## 🧪 Validation

- Validation QA GO sur Technique/Typage, Sécurité/Accès et Bases de données/Purge. `npx tsc --noEmit` : 0 erreur.

## ℹ️ Prérequis Supabase (déjà satisfait)

Ce cycle s'appuie sur une intervention manuelle déjà effectuée par l'utilisateur sur le schéma Supabase de **production** (ajout des colonnes `escalade_niveau`, `has_invalid_date`, `note_signalement_absence` à `t_cartes`). Ce prérequis a été confirmé satisfait avant le début de ce cycle de développement — **aucune action supplémentaire n'est requise sur les centres en production.**

## ℹ️ Mise à jour automatique

Cette release est distribuée via le système d'auto-update Electron. Les postes connectés recevront la notification de mise à jour automatiquement (bandeau persistant, installation à la fermeture de l'application). **Aucune action manuelle n'est requise sur les centres en production.**
