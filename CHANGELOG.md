# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/spec/v2.0.0.html).

## [2.5.3] - 2026-07-16

### Corrigé
- **Sync/Base de Données :** L'OutboxService traduit désormais correctement les colonnes `centre_id`, `site_id`, et `poste_id` (format SQLite) en `id_centre`, `id_site`, et `id_poste` avant de transmettre les données en temps réel au serveur Supabase. Fin des rejets de synchronisation (erreur `Could not find the 'centre_id' column of 't_cartes'`).

## [2.5.2] - 2026-07-16

### Ajouté
- **UI :** Intégration d'un footer global dynamique (signature et année calendaire automatique) sur toutes les pages de l'application via le gabarit principal `MainLayout`.

## [2.5.1] - 2026-07-16

### Corrigé
- **Inventaire Physique :** Correction de l'erreur SQL `no such column` lors de la recherche combinée d'inventaire.
- **Enforcer :** Suppression définitive des reliquats de blocage de version Supabase et libération de l'UI.
- **Auto-Updater :** Compatibilité rétablie avec les dépôts publics pour l'auto-updater.

## [2.5.0] - 2026-07-16

### Supprimé
- **Contrôle de Version Distante (Supabase) :** Retrait complet de la mécanique de blocage forcé des versions obsolètes via Supabase (interface Governance, bandeau Login, handlers IPC et APIs). La gestion des mises à jour est désormais entièrement déléguée au gestionnaire autonome natif (`electron-updater`) de manière silencieuse et non-bloquante au démarrage.

## [2.4.0] - 2026-07-15

### Ajouté
- **Gestion Multi-Rôles :** Affichage d'une fenêtre de sélection dynamique à la connexion permettant aux utilisateurs possédant plusieurs casquettes (ex: Opérateur de Saisie, Opérateur de Qualité, etc.) de choisir leur profil de travail, redirigeant ainsi vers l'interface correspondante.
- **Rafraîchissement manuel :** Intégration d'un bouton de rafraîchissement réactif sur le Dashboard des administrateurs.

### Corrigé
- **Sécurisation des opérations destructrices (IPC) :** Renforcement strict des vérifications de rôles (`verifyUserRole`) pour l'effacement des dossiers CMU et le lancement du moteur d'importation. Un utilisateur sans droits ne peut plus utiliser de point d'entrée masqué pour forcer un import ou une suppression.
- **Routage UI et Navigation (Clean Code) :** Consolidation des routes. Les doublons parallèles d'interfaces entre administrateurs et opérateurs ont été fusionnés. Les administrateurs accèdent dorénavant directement aux mêmes portails d'agents que les opérateurs avec leurs droits étendus (Vérification, Qualité, Saisie).

## [2.3.1] - 2026-07-09

### Corrigé
- **Bypass de connexion d'urgence :** Correction de la logique de contournement du blocage de version sur l'IHM de Login pour s'assurer que le compte de secours matériel `"root"` (saisi dans l'identifiant) outrepasse instantanément et désactive la barrière de mise à jour obligatoire (au même titre que les rôles `SUPER ADMIN` et `ADMINISTRATEUR_SITE`).
- **Audit de la Table Supabase :** Validation du schéma de la table distante `t_app_version` et rédaction du script d'audit d'alignement pour garantir la présence des quatre colonnes indispensables (`id`, `version_minimale`, `url_telechargement`, `is_active`).

## [2.3.0] - 2026-07-09

### Ajouté
- **Panneau de configuration des versions :** Intégration d'un espace de contrôle interactif réservé aux rôles `SUPER_ADMIN` et `ADMINISTRATEUR_SITE` dans la vue Governance du Dashboard, permettant de piloter l'activation (`is_active`), la version minimale exigée et le lien de téléchargement.
- **Restauration de la Charte Graphique & Signatures :**
  - Rétablissement du titre officiel `"GESTION CARTES IN-SITU"` sur le Login et l'entête principale.
  - Affichage dynamique de `"IN-SITU - [SiteNom]"` sur la barre latérale.
  - Signature réglementaire : `"GEST-IN-SITU v2.3.0 - © Ebychoco 2026 - Tous droits réservés"` dans le footer.
- **Passe-droit d'administration (Bypass) :** Autorisation de connexion pour les comptes administrateurs (`SUPER ADMIN` et `ADMINISTRATEUR_SITE`) même si l'application locale est obsolète, permettant d'accéder au panneau de configuration Supabase à chaud.

## [2.2.0] - 2026-07-09

### Ajouté
- **Contrôle à distance des versions obligatoires :**
  - Handler IPC `app:checkRemoteVersion` interrogeant la table Supabase `t_app_version` pour vérifier la version minimale obligatoire requise.
  - Handler IPC `app:openExternal` pour ouvrir des URLs de mise à jour à l'extérieur d'Electron dans le navigateur par défaut de l'utilisateur.
  - Bandeau d'alerte et de blocage réactif rouge et clignotant sur l'interface de Login si `VERSION_LOCALE < VERSION_MINIMALE_SUPABASE`.
  - Bouton d'action "Télécharger la mise à jour" redirigeant l'utilisateur vers le lien de téléchargement configuré sur Supabase.
  - Résilience hors-ligne : La vérification est ignorée en cas de coupure de réseau pour ne jamais bloquer l'opérateur localement sur le terrain.

## [2.1.0] - 2026-07-09

### Ajouté
- **Sécurisation du Premier Démarrage :** Handler `app:checkFirstLaunch` sur le processus principal et mise en place d'un système de blocage réactif sur l'IHM de Login (table `t_users` vide + blocage hors-ligne / déblocage automatique après synchronisation globale Supabase en ligne).

### Corrigé
- **Blindage des Migrations & Alignement du Schéma SQLite :**
  - Ajout des colonnes critiques `is_dirty` et `synced_at` manquantes dans les DDL de reconstruction de la table `t_users` des migrations `V15`, `V16` et `V17`.
  - Alignement des colonnes `is_read` et `site_id` de la table `t_logs` dans le schéma initial `migrateV1`.
  - Neutralisation de l'erreur `FOREIGN KEY constraint failed` pour le compte `ROOT` de secours en mappant `id_user` à `NULL` dans la table `t_logs`.
  - Implémentation du filet de sécurité universel `migrateV27_safetyNet` pour corriger automatiquement à chaud toute anomalie de colonnes manquantes au démarrage.
  - Ajout d'une logique de reconstruction d'urgence (`try/catch` global dans `runMigrations`) générant une sauvegarde de sécurité `database_backup_emergency_TIMESTAMP.db` et reconstruisant proprement le schéma en version 26 en cas de crash critique.
- **Détourage Graphique de l'Icône :** Suppression des bandes blanches verticales parasites sur les côtés gauche et droit de `icone.jpeg` et recompilation du conteneur multi-résolutions transparent `icon.ico` (16px à 256px).
