# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/spec/v2.0.0.html).

## [2.13.0] - 2026-08-11

### 🚀 Nouveautés & Ergonomie

- **Nouveau rôle OPERATEUR_APUREMENT avec portail dédié (`/apurement`)** : réutilise le composant d'apurement existant avec sa propre barre de synchro cloud ; l'onglet APUREMENT reste également disponible dans Inventaire & Logistique pour les rôles existants (aucun retrait). Routage, redirection post-connexion, écran de sélection de rôle, navigation et compteurs cloud/dirty mis à jour en conséquence.
- **Portail Apurement :** nouvel onglet "Vue d'ensemble" avec 4 KPI (Aujourd'hui/Semaine/Mois/Année) et une liste paginée du travail du jour, aux côtés de l'onglet existant "Travail d'apurement".
- **Alerte de décharge en doublon (Apurement / Inventaire & Logistique)** : une modale avertit désormais l'agent avant d'écraser l'émargement d'une carte déjà déchargée (statut DELIVRE), en affichant la date, l'agent et le retirant déjà enregistrés.
- **Portails Vérification et Saisie :** ajout d'un onglet "Travail du jour" paginé, cohérent avec le nouvel onglet Apurement.
- **Inventaire & Logistique :** ajoute le badge "Cartes disponibles en local", le bouton Actualiser, "Récupérer les cartes depuis le Cloud" et "Envoyer les corrections", au même niveau que le Portail Qualité (jusque-là inopérants pour OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE).
- **Mon Profil :** l'ADMINISTRATEUR_SITE peut désormais modifier son propre login (vérification d'unicité, rejet si collision).
- **Mise à jour automatique — bandeau persistant :** remplace l'ancien toast de mise à jour (qui disparaissait seul après 10 s sans qu'aucune installation ne soit visiblement déclenchée) par un bandeau non bloquant qui n'disparaît que sur clic explicite, expliquant que l'installation se déclenche à la fermeture de l'application.
- **Mise à jour automatique — installation visible avec relance automatique :** remplace le déclenchement implicite silencieux d'electron-updater par un déclenchement explicite, en aval de la vérification "synchronisation/import en cours" qui protège déjà la fermeture normale de l'application. L'installeur NSIS passe en mode `oneClick` avec relance automatique et un script personnalisé (`build/installer.nsh`) qui grise le bouton de fermeture pendant la copie des fichiers ; un marqueur de version (`pending-update.json`) permet de détecter au démarrage suivant une mise à jour qui ne se serait pas correctement appliquée.

### 🛠️ Corrections & Sécurité

- **Gel derrière "Chargement sécurisé en cours..." sur 9 pages** (Cartes, Recherche, Profil, Tableau des cartes, Agents, Export, File d'attente Admin, Maintenance, Journaux) : ces pages ne levaient jamais le flag de chargement initial, atteintes en premier après connexion elles gelaient l'interface indéfiniment. Ajout d'un filet de sécurité global (timeout 10 s) qui force la levée du flag si aucune page ne l'a fait.
- **Portail Retraits :** le flag de chargement sécurisé n'était jamais levé sur cache froid (seul un effet de bord fortuit d'une autre page le faisait auparavant).
- **Durcissement des statistiques Vérification/Apurement/Saisie :** les handlers `stats:getVerification`, `stats:getCardsToday` et les endpoints associés ne vérifiaient pas l'identité de l'appelant, permettant de consulter les statistiques d'un autre agent en forgeant l'appel IPC (identité et site désormais toujours dérivés de la session serveur pour tout rôle non-SUPER ADMIN).
- **Durcissement `auth:updateSelfProfile` :** l'identité ciblée est désormais dérivée de la session serveur et non plus d'un identifiant client falsifiable.
- **Faille préexistante sur `cartes:searchCombinedInventaire` :** contrôle de rôle jusque-là totalement absent, ajouté.

### 🧱 Base de Données

- **Migrations `SCHEMA_VERSION` 62 → 65** (`migrateV63`, `migrateV64`, `migrateV65`) : ajout de la colonne `relation_retirant` à `t_cartes` ; élargissement des contraintes `CHECK(role)` de `t_users`/`t_user_roles` pour le nouveau rôle OPERATEUR_APUREMENT (pattern sécurisé avec backup physique, transaction exclusive et vérification d'intégrité, corrige au passage un bug de contrainte FK réel sur `t_user_roles`) ; migration des clés `t_config` `auto_downstream_<login>` vers `auto_downstream_<id_user>` (clés stables qui survivent désormais à un renommage de login). Migrations additives, aucune perte de données.

### 🧪 Infrastructure de Test

- Couverture e2e additionnelle (agent-13 QA terrain) : barre de synchro cloud Inventaire, nouveau rôle/portail OPERATEUR_APUREMENT (17 scénarios), gel de chargement sur 9 pages + filet de sécurité global, cache froid Retraits, modification du login ADMINISTRATEUR_SITE et migration v65 (13 scénarios), Vue d'ensemble Apurement (17 scénarios), bandeau de mise à jour persistant (10 scénarios), marqueur de mise à jour au démarrage.

### ⚠️ Points de vigilance connus

- Le script NSIS personnalisé (`build/installer.nsh`) et le mode `oneClick` de l'installeur n'avaient encore jamais été vérifiés par une compilation réelle avant cette release — validés lors du build de packaging de cette version.

---

## [2.12.0] - 2026-08-10

### 🚨 Sécurité (Critique)

- **Fuite de données inter-sites sur le Monitoring Synchronisation :** le tableau des anomalies (`t_logs`) de la page `/sync/status` n'appliquait aucun filtrage `site_id` côté serveur — un ADMINISTRATEUR_SITE pouvait consulter les logs de synchronisation d'un autre site (le SUPER ADMIN conserve légitimement sa vue globale). Corrigé.
- **Fuite intra-site sur le Portail de Saisie :** un opérateur de saisie pouvait, via un appel IPC forgé, consulter les brouillons d'un autre agent du même site — le handler `cartes:getPage` ne réimposait pas l'identité (`created_by`) de l'agent connecté. Le serveur réimpose désormais systématiquement l'identité réelle de la session.

### 🛠️ Corrections & Sécurité

- **Risque de corruption SQLite en production (`SQLITE_CORRUPT_VTAB`), Centre de Migration :** un enchaînement Réparation d'urgence + Purge pouvait provoquer une corruption transitoire de la base, causée par un `VACUUM` fire-and-forget non synchronisé combiné à une reconstruction complète de l'index FTS5 pendant la réparation d'urgence. Corrigé par un `VACUUM` synchrone/attendu et une purge FTS5 incrémentale (au lieu d'un `DROP`/`CREATE` de la table virtuelle) ; effet de bord corrigé au passage, l'ancien code effaçait aussi l'index de recherche des **autres sites** lors d'une réparation d'urgence.
- **Risque métier — perte silencieuse du statut "Délivrée" (Portail de Saisie) :** une correction mineure (ex. rangement) sur une carte déjà délivrée mais pas encore synchronisée la faisait repasser silencieusement au statut "En Stock" — risque de double-délivrance et d'incohérence d'inventaire physique. Corrigé : le statut d'une carte n'est plus jamais écrasé lors d'une simple correction de champ.
- **Corbeille de suppression de ligne inopérante à l'aperçu d'import (Centre de Migration) :** l'exclusion d'une ligne à l'aperçu n'était qu'un filtre d'affichage — la ligne était tout de même importée. L'exclusion est désormais effective jusqu'au Worker d'import.
- **Brouillon sans date de naissance impossible à sauvegarder (Portail de Saisie) :** le serveur validait la date de naissance même en mode brouillon, alors que l'interface promet explicitement que les informations manquantes sont tolérées à ce stade. Corrigé ; en contrepartie, un brouillon à date invalide ou manquante ne peut désormais plus être promu en "En Stock" sans être revalidé — il reste en brouillon et l'agent est averti du nombre de brouillons ignorés lors de la promotion en masse.
- **Page "Mes Brouillons" bloquée indéfiniment sur "Chargement en cours..." (Portail de Saisie) :** cause structurelle — le site actif de l'agent n'était jamais résolu correctement pour le rôle OPERATEUR_SAISIE. Corrigé.
- **Écran de Monitoring Synchronisation pouvant rester figé indéfiniment** derrière l'overlay de chargement global si un SUPER ADMIN y naviguait avant la fin du chargement initial du Dashboard — corrigé.
- **Filtres Agent et Date du "Pilotage des Activités de Terrain" sans aucun effet** (seul le filtre Centre fonctionnait) : les handlers IPC correspondants ignoraient silencieusement ces paramètres pourtant transmis par l'interface — corrigé.
- **Logs WARN/WARNING/LIMIT jamais affichés** dans le tableau du Monitoring Synchronisation (filtre SQL trop restrictif) — corrigé.
- **Message trompeur "Synchronisation terminée avec des avertissements"** affiché même quand la synchronisation n'avait jamais démarré (cas hors-ligne) — affiche désormais le véritable message d'échec.
- **Détection des "doublons probables" à l'import structurellement inopérante** (ordre d'exécution erroné) — corrigée.
- **Compteur de cartes locales du Centre de Migration non filtré par site** (activait/désactivait à tort le bouton de purge) — corrigé.
- **Texte de la modale de réparation d'urgence incomplet :** ne mentionnait pas la suppression des cartes locales qu'elle effectue réellement — texte rendu honnête.
- **Alias d'en-tête CSV "N° SECU" (sans accent) manquant** à l'import, colonne silencieusement vide — ajouté. Libellé "Rejetées/Erreurs" ambigu clarifié en "Anomalies Signalées".
- **Message de doublon strict affiché de façon générique** au lieu du message spécifique (Portail de Saisie) — corrigé.
- **Bouton "Télécharger depuis le Cloud" non désactivé hors-ligne** sur le Portail de Saisie, incohérence avec les autres portails déjà corrigés — corrigé.
- **Toasts de rafraîchissement pouvant s'empiler** sur clics rapprochés (Monitoring Synchronisation) — corrigé.

### 🧹 Nettoyage

- **Retrait de la fonctionnalité "Auditer les Dates Invalides"** du Tableau de bord (bouton, handler IPC backend, exposition preload) — retrait demandé explicitement, fonctionnalité totalement supprimée sans remplacement.
- **Retrait d'un bloc de code mort ("Synchronisation Cloud — Centre")** et de 9 branches conditionnelles associées au rôle ADMIN_CENTRE sur le Tableau de bord, confirmé structurellement inatteignable sur cette page par analyse de l'historique git (ce rôle a toujours eu son propre portail dédié).

---

## [2.11.1] - 2026-08-04

### 🛠️ Corrections & Sécurité

- **Rôle actif non synchronisé avec le serveur pour les comptes multi-rôles :** le choix d'un rôle sur l'écran de sélection (compte cumulant plusieurs rôles, ex. `ADMIN_CENTRE` + `OPERATEUR_VERIFICATION`) ne mettait à jour que l'affichage côté client — le serveur continuait d'appliquer les règles de cantonnement du rôle de connexion pour toute la session. Effet concret : un agent basculé en Vérification alors que son rôle de connexion était `ADMIN_CENTRE` voyait ses statistiques (dont le total "Cartes disponibles en local"), listes d'agents, journaux d'audit et tirages d'agents bridés à tort au périmètre de son seul centre au lieu du site entier. Corrigé par un nouveau canal serveur qui revalide le rôle demandé par rapport aux rôles réellement attribués au compte avant de synchroniser la session — sans risque de fuite inter-site, le site et le centre restant toujours attachés au compte, jamais au rôle choisi.

## [2.11.0] - 2026-08-04

### 🛠️ Corrections & Sécurité

- **Écran "Base de données locale vide" affiché à tort sur le portail Vérification :** le calcul se basait par erreur sur le stock du CENTRE de l'agent au lieu du SITE, bloquant la recherche pour un agent d'un centre à faible/0 stock local alors que le site contenait bien des cartes. Corrigé pour rester cohérent avec la recherche elle-même (jamais filtrée par centre, seule la délivrance l'est).
- **Bouton "Actualiser" pouvant afficher des KPI périmés :** le cache serveur (TTL 15s) sur le calcul des indicateurs du tableau de bord ne distinguait pas un rafraîchissement automatique en arrière-plan d'un clic explicite — un clic dans les 15 secondes suivant le dernier calcul pouvait afficher d'anciennes valeurs sans le signaler. Un clic explicite sur "Actualiser" contourne désormais systématiquement ce cache (également appliqué au rafraîchissement post-pull cloud réussi) ; les rafraîchissements automatiques/silencieux continuent d'en bénéficier normalement.

### 🚀 Nouveautés & Ergonomie

- **Portail Vérification :** ajout d'un second indicateur "Les cartes de ce centre" à côté du total du site existant, pour distinguer d'un coup d'œil ce qui est disponible pour la recherche (le site) de ce qui est physiquement délivrable depuis son propre centre.
- **Bouton "Actualiser" ajouté sur 6 interfaces qui n'en disposaient pas :** portail Vérification, tableau de bord Opérateur Saisie, vue globale SUPER ADMIN, Journaux, portail Qualité, portail Saisie.

### ⚡ Performances & Optimisations

- **Chargement initial du tableau de bord très lent sur les sites à fort volume** (~400 000 cartes et plus), corrigé en deux temps :
  - Nouvel index composite `idx_cartes_created_by_created_at` (`migrateV61`, `SCHEMA_VERSION` 60 → 61) : jusqu'à 7 secondes ramenées à 1-2 millisecondes sur la requête statistique concernée.
  - Nouvel index composite `idx_cartes_site_centre_statut` (`migrateV62`, `SCHEMA_VERSION` 61 → 62) : la sous-requête de répartition des cartes par centre dans le calcul des KPI globaux (étape "Extraction des KPI globaux") passe d'environ 5,5 secondes à environ 0,7 seconde sur le même volume.
  - Les deux migrations sont additives (aucune donnée modifiée), validées sur le cycle complet nouvelle installation et mise à niveau depuis une base existante (v60/v61 → v62, aucune perte de données), avec résultats de `getStats()` identiques avant/après.
  - Parallélisation mineure de deux requêtes indépendantes dans `useDashboardStats.ts`.

### 🧱 Base de Données

- **Migrations `SCHEMA_VERSION` 60 → 62** (`migrateV61`, `migrateV62`) : deux migrations additives dédiées à la performance du tableau de bord (voir détail dans la section Performances ci-dessus). Aucune perte ni altération de données existantes.

### 🧪 Infrastructure de Test

- Couverture e2e additionnelle : reproduction et validation du filtre centre/site sur la recherche Vérification, cycle de migration v60/v61→v62 avec vérification d'intégrité et de conservation des données, reproduction du cache KPI périmé sur "Actualiser", et validation des 6 nouveaux boutons "Actualiser".

---

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
