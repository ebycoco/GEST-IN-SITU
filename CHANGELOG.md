# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/spec/v2.0.0.html).

## [2.10.0] - 2026-08-03

### 🚨 Sécurité (Critique)

- **Cloisonnement site sur la gestion de la hiérarchie (sites/centres) :** les opérations de consultation, modification et suppression de sites/centres sont désormais strictement limitées au périmètre de l'utilisateur connecté (le SUPER ADMIN conserve l'accès multi-site) — empêchait auparavant un Administrateur de Site d'agir sur un site qui n'était pas le sien, y compris en suppression en cascade.
- **Fermeture d'un accès de secours détourné :** le mécanisme de secours administrateur (purge d'urgence, import de base) dérive désormais systématiquement l'identité de la session serveur réelle plutôt que d'un identifiant transmis par le client — le véritable mot de passe d'urgence reste fonctionnel et intact.
- **Export/Import de base de données protégés :** l'export complet de la base est désormais réservé aux rôles habilités ; l'import — y compris depuis l'écran de connexion, avant authentification — exige désormais la saisie du mot de passe SUPER ADMIN réel.
- **12 handlers IPC supplémentaires recadrés sur le site réel de l'utilisateur** (consultation/transfert de cartes, signalements, inventaire physique, recherche CMU, synchronisation des agents, journal d'audit, profils).
- **Fuite de lecture cross-site sur le portail Qualité :** les points de recherche/listing (doublons, données manquantes, dates invalides, recherche universelle) recadrent désormais systématiquement sur le site réel de l'utilisateur connecté, empêchant la consultation de données personnelles (identité, contacts, numéro de sécurité sociale) d'un autre site.

### 🛠️ Corrections & Sécurité

- **Corruption FTS5 non rattrapée :** la délivrance, le transfert de carte, le scan d'inventaire physique et la résolution/réactivation de signalement appliquent désormais le même mécanisme d'auto-guérison déjà en place sur la modification de carte, mettant fin à des blocages `database disk image is malformed` rencontrés en usage terrain.
- **Délivrances de cartes jamais remontées vers Supabase** (bug présent en production depuis le 22 juillet) : la délivrance, la résolution/le signalement d'absence et la fusion de doublons enfilent désormais systématiquement la ligne carte complète et à jour vers la file d'envoi, au lieu d'un payload partiel auparavant rejeté silencieusement.
- **Panneau de correction Qualité bloqué sur une fiche à date de naissance invalide :** toute correction, même sans rapport avec la date, échouait auparavant — corrigé.
- **Portail Vérification :** statistiques "Aujourd'hui"/"Hier" figées à 0, notification de résolution de signalement pointant vers un écran blanc, badge "Escaladée au Site" jamais affiché et écran "Base de données locale vide" jamais déclenché — tous corrigés.
- **Recherche rapide logistique (`searchQuickLogistique`) totalement inopérante** (erreur de syntaxe SQL) — corrigée.

### ⚡ Performances & Optimisations

- **Journal d'audit Qualité :** masquage cohérent du numéro de sécurité sociale et du contact sur les deux chemins de sauvegarde des corrections.
- **Purge Cloud & synchronisation :** reprise automatique (retry) sur incident réseau transitoire lors de la purge et du tirage descendant ; gardes de réentrance ajoutées autour des upserts site/centre.
- **Worker d'envoi (`upload-worker.js`) :** alignement des champs transmis (dont `agent_signalement_absence`) sur le mapping standard, préservant la traçabilité des signalements d'absence.

### 🧱 Base de Données

- **Migration `SCHEMA_VERSION` 59 → 60 :** `migrateV60` reconstruit la table `t_cartes` pour imposer durablement le statut `DOUBLON` dans la contrainte `CHECK(statut)`, corrigeant l'échec silencieux de la migration v59 (écriture directe dans `sqlite_master` bloquée par le mode défensif de `better-sqlite3` — la fonctionnalité "Import sécurisé — Statuts valides" de la v2.9.0 n'était donc pas réellement effective en production jusqu'ici). Migration additive et non destructive : backup physique automatique, transaction exclusive, vérification d'intégrité et de clés étrangères avant validation, restauration de tous les index/triggers existants.

### 🧪 Infrastructure de Test

- Mise en place d'une suite de tests end-to-end Playwright isolée (base SQLite jetable, garde-fou anti-production), avec couverture des rôles Opérateur Vérification, Opérateur Qualité et Administrateur Site, ainsi qu'une suite de non-régression sécurité dédiée.

---

## [2.9.0] - 2026-07-30

### 🚀 Nouveautés & Ergonomie

- **Module Qualité — Onglet "Autres Anomalies" :** Nouvel onglet dédié sur la page Qualité permettant de consulter, filtrer et corriger les cartes dont le statut est inconnu (ex : `ERREUR`, `NUMERO INCORRECT`, `INJOIGNABLE`). Comprend un panneau de correction latéral complet (`CorrectionSidePanel`) et un détail expandable (`ExpandedAnomalyDetails`).
- **Module Qualité — Détail "Données Manquantes" Expandable :** Intégration du composant `ExpandedManquantDetails` sur l'onglet "Données Manquantes" pour afficher les champs manquants carte par carte de façon claire et interactive.
- **Statistiques Globales — "Autres Anomalies" & "Dates Vides" :** Les indicateurs KPI du tableau de bord Admin incluent désormais deux nouvelles métriques : le compte des cartes à statut inconnu (`autres_anomalies`) et celui des cartes avec date de naissance vide (`dates_naissance_vide`), avec liens directs vers les onglets de correction.
- **Import sécurisé — Statuts valides :** Lors de l'import CSV/Excel, seul `DOUBLON` est désormais accepté comme statut alternatif légitime (au même titre que `DELIVRE` ou `EN STOCK`). Les statuts terrain non standard (`NUMERO INCORRECT`, `INJOIGNABLE`, `ERREUR`) sont rejetés et tracés comme `STATUT_INCONNU`, préservant l'intégrité des données.
- **Message Statut Inconnu Enrichi :** Le message de confirmation affiché lors d'un import avec statut non reconnu précise désormais le statut exact en gras (ex : _"Cette carte a un statut inconnu **ERREUR** mais a été sauvegardée en stock."_).
- **Bouton "Forcer en Stock" repositionné :** Le bouton d'action "Forcer en Stock" est désormais intégré à l'intérieur du panneau de détail de la carte pour une ergonomie terrain cohérente.
- **Validateurs Partagés :** Nouveau module `src/shared/utils/validators.ts` centralisant les règles de validation des données (dates, contacts, numéros de sécu) utilisées transversalement dans l'application.

### 🛠️ Corrections & Sécurité

- **Moteur Upstream (Outbox) :** Robustesse accrue du service d'outbox pour les opérations en attente, prévenant des pertes de données lors d'interruptions réseau.
- **Worker de Téléchargement :** Corrections de la logique du `download-worker.js` pour une meilleure gestion des conflits de fusion lors du tirage descendant.
- **Requêtes Hiérarchie & Import :** Fiabilisation des requêtes d'accès aux sites/centres et du pipeline d'import multi-formats.
- **Heartbeat de Session :** Amélioration du gestionnaire de battement de session (`session-heartbeat`) pour éviter les déconnexions intempestives.

### ⚡ Performances & Optimisations

- **Suppression de pages obsolètes :** Retrait de `AdminCentreDashboardPage`, `AnomaliesView` et `QualiteAssainissementPage`, nettoyant la base de code et réduisant le bundle final.
- **Hook `useDebounce` :** Nouveau hook partagé pour limiter les appels IPC lors des saisies en temps réel dans les barres de recherche de la page Qualité.
- **Store Qualité (`qualityUIStore`) :** Refactorisation du store Zustand dédié à l'état de l'interface Qualité pour une meilleure séparation des responsabilités.

---

## [2.8.0] - 2026-07-30

### 🚀 Nouvelles Fonctionnalités
- **Détection des Cartes Fantômes :** Nouveau compteur et nouvelle étape dédiée (Étape 3, avant le blocage des dates invalides) pour les cartes locales dont l'identité est totalement vide (nom, prénom, numéro de sécu et rangement tous absents) — jusqu'ici invisibles de tous les indicateurs et jamais synchronisables. Un clic renvoie directement vers la page Qualité pour correction.
- **Enfilage Automatique des Corrections Qualité :** Les corrections individuelles (date de naissance, champs rapides, rangement) sont désormais poussées vers le Cloud quasi instantanément si une connexion est disponible, avec garde de conformité (aucun envoi automatique si la carte a encore un doublon ou une date invalide non résolue).

### 🛠️ Corrections & Sécurité
- **Tirage Descendant (Anti-Perte de Données) :** Le repère de synchronisation (watermark) n'est plus écrasé par l'heure locale du poste après le cycle automatique de 2h ; une marge de sécurité absorbe désormais un décalage d'horloge résiduel côté poste expéditeur, éliminant un risque de carte jamais détectée par les autres postes.
- **Sécurité IPC :** Le endpoint `sync:getCloudCartesCount` applique maintenant le même contrôle d'accès site/rôle que les autres endpoints de synchronisation (empêchait auparavant la consultation du compteur d'un autre site).
- **Horodatage à l'Envoi :** Les cartes envoyées en masse portent désormais l'heure réelle d'envoi (et non la date de dernière édition locale), garantissant leur détection par les autres postes lors d'un tirage ultérieur.
- **Purge Cloud Résiliente :** Ajout d'une reprise automatique (retry) sur incident réseau transitoire lors de la purge Cloud, qui pouvait auparavant échouer définitivement sur un simple timeout après des milliers de cartes déjà supprimées.
- **Cohérence Badge/Envoi (Saisie, Vérification, Admin Centre) :** Le bouton d'envoi n'active plus sur des cartes que le filtre de conformité rejetterait silencieusement au moment de l'envoi réel.
- **Total Cartes :** Le KPI reflète désormais le nombre réel de cartes locales, sans y ajouter les anomalies encore en attente de correction dans la file d'import.

### 🧹 Nettoyage
- Suppression de boutons non fonctionnels (gestionnaire IPC manquant : purge d'assainissement globale, envoi des modifications redondant) et du code mort lié à l'ancien mécanisme de synchronisation par file d'attente (`t_sync_queue`).

---

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
