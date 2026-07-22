# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/spec/v2.0.0.html).

## [2.7.0] - 2026-07-22

### 🚀 Nouvelles Fonctionnalités
- **Module Table Cartes :** Implémentation complète d'une vue tabulaire avancée des cartes CMU avec gestion des statuts de synchronisation, verrouillage global anti-spam et filtres multicritères.
- **DeliveryProofModal :** Création d'une modale dédiée (`DeliveryProofModal`) en lecture seule affichant l'historique et la preuve de retrait sécurisée dès lors qu'une carte possède le statut `DELIVRE`.
- **Routage Intelligent (Délivrance) :** Bypass automatique de l'étape de vérification physique lors d'une recherche de carte déjà délivrée — ouverture instantanée de la preuve de retrait.

### 🛠️ Corrections & Sécurité
- **Droits et Permissions :** Résolution d'un blocage critique (« Accès refusé ») qui empêchait les agents habilités de délivrer les cartes.
- **Canaux IPC :** Déclaration des handlers manquants (`debug:getAllAnomalies`) pour prévenir les erreurs de communication asynchrone entre le processus Renderer et le Main Process.
- **Isolation Multi-Sites :** Renforcement du cloisonnement des données par `site_id` sur le module de délivrance pour prévenir toute fuite inter-sites.

### ⚡ Performances & Optimisations
- **Responsive Design (Admin) :** Refonte visuelle de la page « File d'attente de traitement » (`AdminQueuePage`) via une structure Flexbox ultra-fluide (`flexWrap`, `flex-basis`), garantissant un affichage optimal sur toutes tailles d'écran.
- **Synchronisation Cloud :** Améliorations ciblées de la logique `Delta Sync` et du bouton de synchronisation pour réduire la charge réseau et prévenir les crashs du moteur de synchronisation.

---

## [2.6.1] - 2026-07-22

### 🚀 Nouveautés & Ergonomie
- **Interface Utilisateur :** Création d'une modale dédiée (`DeliveryProofModal`) en lecture seule pour afficher l'historique et la preuve de retrait de façon claire lorsqu'une carte a déjà le statut `DELIVRE`.

### 🛠️ Corrections & Sécurité
- **Droits et Permissions :** Résolution d'un blocage critique ("Accès refusé") qui empêchait les agents ayant le rôle adéquat de délivrer les cartes.
- **Routage Intelligent :** Lors de la recherche d'une carte déjà délivrée, l'application bypasse automatiquement l'étape obsolète de vérification physique pour ouvrir instantanément la preuve de retrait.
- **Canaux IPC :** Déclaration des handlers manquants (`debug:getAllAnomalies`) pour prévenir les erreurs de communication asynchrone entre l'interface et le processus principal.

### ⚡ Performances & Optimisations
- **Responsive Design (Admin) :** Refonte visuelle de la page "File d'attente de traitement" (`AdminQueuePage`) via une structure Flexbox ultra-fluide (`flexWrap`, `flex-basis`), garantissant un affichage optimal et réactif sur toutes les tailles d'écrans.
- **Synchronisation Cloud :** Améliorations ciblées de la logique `Delta Sync` et du bouton de synchronisation pour réduire la charge réseau et prévenir les crashs du moteur de synchronisation.

## [2.6.0] - 2026-07-20

### Ajouté
- **UX (Démarrage) :** Intégration d'un Splash Screen léger (`splash.html`) affiché immédiatement au lancement et lors des mises à jour, éliminant tout écran noir d'attente et rassurant l'utilisateur pendant l'initialisation.
- **UX (Chargement Global) :** Implémentation d'un système de chargement visuel et sécurisé sur l'intégralité des interfaces — overlay élégant avec spinner "Plein Soleil" et verrouillage temporaire de la navigation (Sidebar) pendant le premier chargement initial pour prévenir les race conditions.
- **UX (Opérateur / Admin Centre) :** Ajout d'un écran de chargement Skeleton sur la vue dashboard opérateur (`OperatorView`) et d'indicateurs visuels animés sur la vue Administrateur de Site (`SiteAdminView`) pendant la récupération des statistiques.

### Optimisé
- **Performance (Cache-First) :** Toutes les pages majeures (Dashboard, Qualité, Retraits, Sites, Importation) adoptent désormais une stratégie **cache-first** stricte : si les données sont déjà présentes en mémoire (`useCacheStore`), aucun appel SQLite n'est effectué, la navigation est instantanée et le verrou global est relâché immédiatement.
- **Performance (MainLayout) :** Le verrouillage de la Sidebar est limité au strict premier chargement initial. Les visites ultérieures sur une page déjà chargée sont fluides et instantanées, sans aucun rechargement de base de données.

### Corrigé
- **Synchronisation (SQLite / Supabase) :** Auto-réparation (`auto-healing`) de la base de données locale au démarrage — détection et correction automatique des colonnes manquantes (`lieu`, `prefixe_rangement`) dans `t_centres` via `PRAGMA table_info`.
- **Hiérarchie (Centres) :** Correction de la requête de mise à jour des centres (`updateCentre`) pour inclure le champ `lieu` lors de l'upsert Supabase, garantissant la cohérence complète des données entre local et cloud.
- **UI/UX (Modales) :** Correction du `z-index` des modales à `110000` pour qu'elles s'affichent correctement au-dessus de tous les composants de l'interface, notamment le Splash Screen et les overlays de chargement.
- **Multi-Sites (Isolation) :** Renforcement de l'isolation des données par `site_id` dans les requêtes d'import et de correction qualité pour prévenir toute fuite de données inter-sites.

## [2.5.7] - 2026-07-17

### Corrigé
- **UI/UX (Dashboard Super Admin) :** Suppression définitive de la double signature redondante sur la page Governance — la signature `© Ebychoco 2026` n'apparaît plus qu'une seule fois dans le footer global via `MainLayout`.
- **UI/UX (Page Login) :** Correction du débordement vertical (`overflow`) sur les petits écrans — la page est désormais entièrement scrollable (`height: 100vh` + `overflow-y: auto`) et s'adapte correctement aux résolutions réduites.

## [2.5.6] - 2026-07-17

### Corrigé
- **UI/UX :** Suppression de la double signature redondante sur la vue Governance (Dashboard Super Admin).
- **UI/UX :** Correction du débordement de la page de Login sur les petits écrans en s'assurant de son adaptabilité (`height: 100vh` et `overflow-y: auto`).

## [2.5.5] - 2026-07-17

### Corrigé
- **Auto-Updater :** Activation du téléchargement automatique (`autoDownload = true`) en arrière-plan pour que les futures mises à jour s'installent silencieusement sans nécessiter d'action utilisateur.
- **Auto-Updater :** Activation optionnelle de l'updater en mode développement pour faciliter les tests locaux.

## [2.5.4] - 2026-07-16

### Corrigé
- **UI/UX :** Restauration de l'affichage dynamique de la version de l'application (ex: `v2.5.4`) à l'intérieur de la signature du pied de page global (`© Ebychoco 2026`).

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
