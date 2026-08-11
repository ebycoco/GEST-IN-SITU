# GEST-IN-SITU — Release v2.13.1

> **Date de publication :** 11 août 2026
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire
> **SCHEMA_VERSION :** 66 (migration additive v66, aucune perte de données)

## 🛠️ Correctif critique

- **Migrations SQLite non fiables en cas de données orphelines, avec faux positif "à jour"** (incident production réel constaté sur 2 postes de terrain) : la migration d'élargissement du rôle OPERATEUR_APUREMENT pouvait échouer sur des comptes utilisateurs orphelins (site/centre/poste déjà supprimé), déclenchant un filet de secours de reconstruction d'urgence qui se déclarait à tort "à jour" sans avoir réellement terminé. Sur les postes touchés : schéma durablement incomplet (perte des index de performance, retour du bug de lenteur du tableau de bord déjà corrigé en v2.11.0), avec blocage de toute réparation automatique future.
  - Les comptes orphelins sont désormais neutralisés (journalisés) avant toute vérification, au lieu de faire échouer la migration.
  - Le filet de secours de reconstruction d'urgence rejoue désormais la vraie séquence de migrations et ne se déclare "à jour" qu'après succès réel.
  - Nouvelle vérification structurelle systématique au démarrage (`SCHEMA_VERSION` 65 → 66) : contrôle l'état réel de la base (pas seulement son numéro de version) et répare automatiquement ce qui manque — les postes déjà touchés par l'incident se corrigent d'eux-mêmes à cette mise à jour, sans intervention manuelle poste par poste.
- **Comptes utilisateurs orphelins lors de la suppression d'un site ou d'un centre :** les comptes restants pointant vers un site/centre supprimé sont désormais nettoyés systématiquement (au lieu d'être laissés dans un état incohérent).

## 🧪 Validation

- Couverture de test fonctionnel dédiée (poste sain, simulation exacte de l'incident de production, orphelins injectés, suppression de site/centre via l'interface réelle) : verdict GO, aucune anomalie bloquante ou majeure.

## ℹ️ Mise à jour automatique

Cette release est distribuée via le système d'auto-update Electron.
Les postes connectés recevront la notification de mise à jour automatiquement (bandeau persistant, installation à la fermeture de l'application). Les postes déjà affectés par l'incident décrit ci-dessus se répareront automatiquement à l'application de cette mise à jour.
**Aucune action manuelle n'est requise sur les centres en production.**
