# GEST-IN-SITU — Release v2.13.0

> **Date de publication :** 11 août 2026
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire
> **SCHEMA_VERSION :** 65 (migrations additives v62 → v65, aucune perte de données)

## 🚀 Nouveautés & Ergonomie

- **Nouveau rôle OPERATEUR_APUREMENT avec portail dédié (`/apurement`)** : réutilise le composant d'apurement existant avec sa propre barre de synchro cloud ; l'onglet APUREMENT reste également disponible dans Inventaire & Logistique pour les rôles existants (aucun retrait).
- **Portail Apurement :** nouvel onglet "Vue d'ensemble" avec 4 KPI (Aujourd'hui/Semaine/Mois/Année) et une liste paginée du travail du jour.
- **Alerte de décharge en doublon** (Apurement / Inventaire & Logistique) : une modale avertit désormais l'agent avant d'écraser l'émargement d'une carte déjà déchargée, en affichant la date, l'agent et le retirant déjà enregistrés.
- **Portails Vérification et Saisie :** ajout d'un onglet "Travail du jour" paginé.
- **Inventaire & Logistique :** ajoute le badge "Cartes disponibles en local", le bouton Actualiser, "Récupérer les cartes depuis le Cloud" et "Envoyer les corrections" (jusque-là inopérants pour OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE).
- **Mon Profil :** l'ADMINISTRATEUR_SITE peut désormais modifier son propre login.
- **Mise à jour automatique — bandeau persistant :** remplace l'ancien toast qui disparaissait seul après 10 s par un bandeau non bloquant qui ne disparaît que sur clic explicite.
- **Mise à jour automatique — installation visible avec relance automatique :** le déclenchement de l'installation passe désormais par la même vérification "synchronisation/import en cours" que la fermeture normale de l'application, avec un installeur NSIS en mode `oneClick` et relance automatique, un script personnalisé grisant le bouton de fermeture pendant la copie des fichiers, et un marqueur de version qui permet de détecter une mise à jour mal appliquée au démarrage suivant.

## 🟠 Corrections importantes

- **Gel derrière "Chargement sécurisé en cours..." sur 9 pages** (Cartes, Recherche, Profil, Tableau des cartes, Agents, Export, File d'attente Admin, Maintenance, Journaux), ainsi que sur le portail Retraits en cache froid — corrigé, avec ajout d'un filet de sécurité global (timeout 10 s).
- **Durcissement des statistiques Vérification/Apurement/Saisie et du profil :** l'identité de l'appelant est désormais toujours dérivée de la session serveur (et non d'un paramètre client falsifiable) pour tout rôle non-SUPER ADMIN.
- **Faille préexistante sur `cartes:searchCombinedInventaire` :** contrôle de rôle jusque-là totalement absent, ajouté.

## 🧱 Base de Données

- **Migrations `SCHEMA_VERSION` 62 → 65**, additives : colonne `relation_retirant` sur `t_cartes` ; élargissement des contraintes de rôle pour OPERATEUR_APUREMENT ; migration des clés de préférence de synchro vers un identifiant stable (`id_user`) au lieu du login. Aucune perte de données.

## ⚠️ Point de vigilance

- Le script NSIS personnalisé (`build/installer.nsh`) et le mode `oneClick` de l'installeur sont vérifiés pour la première fois par une compilation réelle sur cette version.

## ℹ️ Mise à jour automatique

Cette release est distribuée via le système d'auto-update Electron.
Les postes connectés recevront la notification de mise à jour automatiquement (bandeau persistant, installation à la fermeture de l'application).
**Aucune action manuelle n'est requise sur les centres en production.**
