# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et ce projet adhère au [Versionnage Sémantique](https://semver.org/spec/v2.0.0.html).

## [2.16.0] - 2026-08-17

### 🚨 Sécurité

- **Cantonnement site/centre basé sur le rôle brut en base au lieu du rôle actif de session, pour les comptes multi-rôles** : plusieurs handlers (`cartes:search`, `debug:getAllAnomalies`, `hierarchy:getCentres`, `db:purge`, `db:emergency-purge`, `maintenance:clearCloudCartes`) et fonctions (`createUser`, `resetAgentPassword`) re-interrogeaient directement `t_users.role` en base pour déterminer le cantonnement, au lieu d'utiliser le rôle **actif** de la session (`getSecureCurrentUser()`, maintenu par `setActiveRole()` lors d'un changement de rôle pour un compte multi-rôles). Découvert via un signalement terrain (recherche de carte devenue introuvable après réaffectation de centre d'un agent multi-rôles) : le rôle stocké en base peut différer du rôle réellement utilisé en session, ce qui pouvait à la fois bloquer indûment un accès légitime (recherche) et, plus grave, contourner des restrictions de portée dans `createUser`/`resetAgentPassword`/les purges destructives pour un compte dont le rôle primaire stocké est plus permissif que le rôle actif choisi. Les 8 occurrences identifiées par audit dédié ont été corrigées pour dériver systématiquement le cantonnement de la session active.

### 🚀 Nouveautés & Ergonomie

- **Indicateur de synchronisation Supabase pour l'opérateur, sur "Travail du jour" (Apurement)** : même badge par carte (Synchronisé/En attente/Échec) + récapitulatif agrégé + rafraîchissement automatique déjà validé sur Vérification/Saisie, porté à l'identique sur le portail Apurement — toutes les actions d'écriture de ce portail (émargement rétroactif, déclaration de doublon) enfilent déjà systématiquement dans `t_outbox`, donc les 3 états sont tous atteignables et l'auto-refresh 30 s a le même sens que côté Vérification.
- **Récapitulatif agrégé de synchronisation sur la Vue d'ensemble Qualité** : contrairement à Vérification/Saisie/Apurement, aucune colonne fiable n'attribue une correction Qualité à un agent et une date précise, et les corrections de ce portail suivent 3 régimes de synchro différents selon l'action (automatique inconditionnel, automatique conditionnel avec abandon silencieux si la carte appartient encore à un groupe de doublons non résolu, ou 100 % manuel) — une vraie liste "mes cartes du jour" par carte n'y est donc pas fiable. À la place, un compteur agrégé site-wide ("X cartes en attente de synchro, dont Y en échec") a été ajouté sur toutes les cartes non synchronisées du site, correct quel que soit le régime de synchro de l'action d'origine, mis à jour via l'écouteur `app:data-updated` déjà utilisé par le compteur existant — aucun nouveau timer.
- **Date de naissance affichée au format JJ/MM/AAAA sur l'écran Apurement Historique** (liste de résultats et fiche du dossier sélectionné) : `date_de_naissance` est stockée en ISO (`AAAA-MM-JJ`) et s'affichait telle quelle, format peu lisible en usage terrain. Reformatée à l'affichage avec le même helper déjà utilisé côté Vérification (`SearchResults.tsx`) — aucune donnée modifiée, purement cosmétique.
- **Nouveau réglage "Envoi Automatique" des cartes vers Supabase** : jusqu'ici, l'envoi automatique des cartes vers le cloud n'avait aucun interrupteur — il tournait en continu dès que le réseau était disponible. Ajout d'une préférence par utilisateur (bascule "Envoi Automatique" sur "Mon Profil", miroir du réglage "Récupération Automatique" existant mais pour le sens envoi), activée par défaut sauf pour `ADMINISTRATEUR_SITE` (désactivée par défaut, ce rôle réalisant les imports massifs). Un bandeau non bloquant rappelle sur l'écran Importation de désactiver ce réglage avant de lancer un import (avec un bouton "Désactiver maintenant"). Le bouton "Envoyer les corrections" (Inventaire, Apurement, Qualité) affiche désormais un badge du nombre de cartes en attente, et reste dans tous les cas une porte de sortie garantie pour toute carte en attente, quel que soit l'état du réglage.
- **Nouvelle page "Présence des Agents"** (Pilotage & Monitoring, réservée `SUPER ADMIN`/`ADMINISTRATEUR_SITE`) : liste des agents `OPERATEUR_*`/`ADMIN_CENTRE` de leur périmètre, avec statut En ligne/Inactif/Hors ligne, dernière connexion/déconnexion et dernière action effectuée. Alimentée par un battement périodique (toutes les 2 min, réutilisant un timer déjà existant) écrit directement vers une nouvelle table Supabase dédiée, en écritures "fire-and-forget" hors du moteur de synchro habituel (donnée éphémère, jamais bloquante pour la connexion/déconnexion). Rôle affiché = rôle actif de la session, cohérent avec les comptes multi-rôles.

Validé par audit de non-régression et QA terrain via harnais Playwright isolé (badge, rafraîchissement, cloisonnement site) et `npx tsc --noEmit` : 0 erreur.

### 🛠️ Corrections & Fiabilité

- **Rôle `OPERATEUR_APUREMENT` ignoré par le bouton manuel "Récupérer les agents depuis le Cloud"** : la liste de rôles valides de `pullAgentsFromCloud` (`users.queries.ts`) avait été oubliée lors de l'introduction de ce rôle (v2.13.0) — un agent Apurement remonté via ce bouton spécifique était silencieusement filtré (`Rôle invalide ignoré`), alors que les autres chemins de synchro (cycle automatique, préchargement au démarrage) le géraient déjà correctement. Corrigé.
- **`ADMIN_CENTRE` ne pouvait pas créer/promouvoir un agent `OPERATEUR_APUREMENT`** : la liste `ASSIGNABLE_ROLES_BY_CREATOR` (`users.queries.ts`) avait le même oubli — `SUPER ADMIN` et `ADMINISTRATEUR_SITE` incluaient déjà ce rôle, pas `ADMIN_CENTRE`, alors qu'il s'agit d'un rôle opérationnel de centre au même titre que les autres `OPERATEUR_*` déjà assignables par ce rôle. Corrigé.
- **Case `OPERATEUR_APUREMENT` toujours absente du formulaire de création d'agent pour `ADMIN_CENTRE`** : le correctif backend ci-dessus n'avait pas d'effet visible côté terrain — `AgentsPage.tsx` excluait encore explicitement ce rôle de la liste proposée à un créateur `ADMIN_CENTRE`, alors que le serveur l'accepte désormais. Retiré de l'exclusion, sans toucher aux autres branches (`SUPER ADMIN`, `ADMINISTRATEUR_SITE`) qui géraient déjà correctement ce rôle.
- **Timeout systématique de la synchronisation descendante des cartes sur les sites à fort volume (constaté site 4, ~40 700 cartes)** : le pull chunké (`runDownstreamChunk`/`runLogsDownstreamChunk`, `downstream.ts`) utilisait un filtre PostgREST `.or(updated_at.gt.X, and(updated_at.eq.X, sync_id.gt.Y))` pour sa pagination par curseur — une construction que Postgres ne peut pas toujours résoudre par un simple parcours d'index trié ; selon le volume restant, le planificateur pouvait retomber sur un plan `BitmapOr` + tri complet, dépassant le `statement_timeout` du serveur et bloquant silencieusement la synchro du site concerné. Remplacé par deux fonctions RPC Postgres (`fn_downstream_cartes_chunk`, `fn_downstream_logs_chunk`) portant une vraie comparaison de tuple `(colonne_date, sync_id) > (watermark, dernier_sync_id)`, associées à deux nouveaux index composites (`idx_cartes_site_updated_syncid`, `idx_logs_site_date_syncid`) garantissant un unique Index Scan trié quel que soit le volume à parcourir.
- **Recherche Apurement "Nom & Prénoms" + "Date de Naissance" ne retrouvait jamais la carte** : `searchCombinedInventaire` (`cartes.queries.ts`, écran OPERATEUR_APUREMENT et identification guidée Qualité) comparait la date saisie au format libre `JJ/MM/AAAA` directement contre `date_de_naissance`, stockée au format ISO `AAAA-MM-JJ` — la comparaison exacte échouait donc systématiquement dès que ce champ optionnel était renseigné, quel que soit le nom. Normalisation ajoutée via l'utilitaire partagé `normalizeDate` déjà utilisé ailleurs dans le projet pour cette même conversion.
- **Même bug de date sur l'écran "Recherche FTS5"** : `searchCartesFTS` (`cartes.queries.ts`) souffrait du même défaut de normalisation sur son filtre `date_de_naissance`, découvert par l'audit de non-régression du correctif ci-dessus — corrigé avec le même utilitaire `normalizeDate`.

Validé par audit de non-régression (`agent-9-senior-auditor`, verdict GO sur les 2 premiers correctifs, et audit dédié ayant révélé le second bug de date), diagnostic et correctif RPC produits par `agent-4-db-sync`, correctifs recherche produits par `agent-3-coder`, et `npx tsc --noEmit` : 0 erreur.

### ⚠️ Points de vigilance connus

- **`SCHEMA_VERSION` inchangé (68)** : aucune migration SQLite additive ce cycle — les évolutions de synchro (RPC Postgres, index composites) sont côté Supabase, hors du schéma local. Confirmé par `agent-12-deploy-validator` puis `agent-11-release-manager` avant publication.
- **Ligne corrompue non bloquante détectée dans `.env`** lors de l'audit GO/NO-GO du 17/08/2026 (`agent-12-deploy-validator`) — sans impact fonctionnel constaté sur ce cycle, à corriger hors de ce chantier.

---

## [2.15.0] - 2026-08-17

### 🚨 Sécurité (Critique)

- **Recherche cloud d'urgence (`searchCloudEmergency`) sans contrôle de rôle ni cloisonnement centre** : ce handler, déclenché en repli quand la recherche locale ne trouve rien, n'imposait aucune vérification de rôle (contrairement aux handlers voisins) et ne recadrait pas le rôle ADMIN_CENTRE sur son propre centre — un ADMIN_CENTRE pouvait ainsi obtenir téléphone et n° CMU en clair de bénéficiaires d'un autre centre du même site. Corrigé : contrôle de rôle ajouté (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_VERIFICATION) et filtre centre appliqué pour ADMIN_CENTRE, basé sur la session serveur.
- **Modification de date de naissance (`updateDate`) sans aucune vérification** : ce handler d'écriture ne vérifiait ni la session, ni le rôle, ni le site de la fiche ciblée — une donnée d'identité sensible pouvait être modifiée sans contrôle. Corrigé : contrôle de rôle (OPERATEUR_APUREMENT, OPERATEUR_INVENTAIRE, ADMINISTRATEUR_SITE, SUPER ADMIN) et vérification que la fiche appartient au site de l'utilisateur avant toute écriture.
- **11 handlers du portail Qualité (doublons, données manquantes, dates invalides, recherche universelle) sans contrôle de rôle** : le cloisonnement par site était correct mais n'importe quel rôle authentifié pouvait, via un appel IPC direct, accéder à ces listings de cartes. Contrôle de rôle ajouté (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_QUALITE) sur les 11 handlers concernés.
- **`cartes:searchQuickLogistique` (portail Logistique) sans contrôle de rôle** : même défaut, corrigé (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_INVENTAIRE, OPERATEUR_LOGISTIQUE).
- **Identité utilisateur falsifiable sur 5 handlers d'écriture/lecture sensibles** : `cartes:create`, `cartes:countDrafts`/`publishDrafts`, `cartes:signalerAbsence`, `cartes:archiveSignalement`/`getArchivedSignalements` dérivaient l'identité (rôle, site, login) d'un objet fourni par l'interface plutôt que de la session serveur — falsifiable via un appel direct, permettant par exemple de forger un rôle SUPER ADMIN pour contourner le cloisonnement site, ou d'agir sous l'identité d'un autre agent. Identité et site désormais dérivés exclusivement de la session serveur non falsifiable sur les 5 handlers. `cartes:getRangements` recevait aussi un site_id non vérifié (fuite de nomenclature inter-sites) — corrigé.
- **`cartes:getPage` (listing cartes/brouillons, 3 écrans) sans contrôle de rôle** : même défaut que les lots précédents, corrigé (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_SAISIE), sans toucher au cloisonnement site/centre et au scoping des brouillons déjà en place.
- **`cartes:search` sans contrôle de rôle, et route `/search` totalement non protégée** : contrairement à toutes les autres routes de l'application, `/search` n'avait aucune restriction de rôle. Handler et route désormais alignés (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_VERIFICATION), cohérent avec le lien "Recherche Rapide" du menu latéral déjà réservé à OPERATEUR_VERIFICATION.
- **Session déjà ouverte non rafraîchie après création/modification d'un compte** : quand un administrateur créait ou modifiait un compte OPERATEUR/ADMIN_CENTRE puis synchronisait vers le Cloud, un poste déjà connecté sur un autre ordinateur ne voyait la mise à jour (nouveau compte, rôle ajouté ou retiré) qu'après un cycle passif de ~2h ou une fermeture/réouverture complète de l'application. Corrigé de bout en bout : un cycle de synchronisation dédié aux comptes/rôles (3 minutes, toujours actif) rapproche rapidement la base locale de l'état Cloud ; la session serveur en mémoire se recalcule automatiquement après chaque cycle réussi ; et l'interface déjà ouverte est désormais notifiée en temps réel (déconnexion automatique si le compte est désactivé ou le rôle actif retiré, mise à jour silencieuse de la liste des rôles disponibles si un rôle est ajouté).
- **Fenêtre de session non fermée en cas de rôle retiré, et comptes désactivés jamais détectés (durcissement du correctif ci-dessus)** : sur un poste dont la fenêtre restait minimisée ou figée, le cantonnement site/centre pouvait continuer à s'appliquer sur la base de l'ancien rôle sans limite de durée ; le cas d'un compte totalement désactivé n'était en réalité jamais détecté. Corrigé : la session est désormais coupée immédiatement côté serveur dès la détection, sans dépendre de l'interface ; une vérification ciblée et légère du statut du compte comble l'angle mort de la synchronisation pour les comptes désactivés ; le message affiché à la déconnexion distingue maintenant rôle retiré, compte désactivé, et conflit de connexion sur un autre poste.

*Ce chantier de durcissement RBAC (recherche, listings, écritures sensibles) est désormais complet sur la famille de handlers `cartes:*` identifiée par l'audit initial. Un pattern similaire (identité fournie par le renderer) a été repéré sans audit approfondi sur les familles `sync:*`/`database:*`/`cmu:*` — à traiter dans un chantier séparé si souhaité.*

### 🚀 Nouveautés & Ergonomie

- **Journal d'Audit Système visible entre postes d'un même site** : les actions CRUD métier significatives (délivrance et transfert de carte, création/modification/suppression d'utilisateur) sont désormais répliquées cross-poste via la table `t_logs` (déjà cloisonnée par `site_id`/`centre_id`), avec un pull dédié câblé sur le cycle de synchro automatique (2 h) et sur "Récupérer les cartes". Les connexions, déconnexions, consultations et exports restent volontairement en trace locale uniquement (postes terrain 8 Go). RBAC déjà en place conservé à l'identique ; la purge d'un log reste locale au poste qui l'exécute et est désactivée sur les entrées provenant d'un autre poste.
- **Journal d'Audit Système enfin lisible par un admin non-technique** : les ~90 types d'action sont désormais traduits en libellés français avec badge coloré cohérent, et les détails s'affichent en phrase naturelle (ex. "Carte n°123 délivrée à Jean Kouassi (pièce n°CI0012345) par l'agent admin_abobo.") avec repli clé/valeur traduit pour les cas non couverts — plus aucun JSON brut à l'écran. La colonne "Opérateur" affiche désormais le nom et le prénom de l'agent (avec son centre).
- **Déclaration manuelle de carte "Doublon" (Opérateur Vérification et Opérateur Apurement)** : quand un requérant affirme détenir déjà sa carte (faite dans une autre ville), ou qu'une carte est identifiée doublon dans le cahier d'émargement rétroactif (Apurement), l'opérateur concerné peut désormais la déclarer explicitement en doublon (motif obligatoire, auteur et date tracés). Une carte ainsi déclarée est bloquée en délivrance sur les deux circuits existants — délivrance classique et émargement rétroactif — avec un bandeau explicite à la recherche, et un avertissement précoce dès la sélection de la carte côté cahier d'apurement. La déclaration reste réversible mais uniquement par un rôle superviseur (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE), jamais par l'opérateur qui l'a posée (motif d'annulation obligatoire, historique jamais effacé). Validé par un test fonctionnel vivant dédié (10 scénarios) — 0 anomalie bloquante.
- **Synchronisation cross-poste des 7 colonnes de traçabilité doublon** : les mappings montant/descendant (`payload-mapper.ts`, `upstream.ts`, `upload-worker.js`, `download-worker.js`) propagent désormais ces colonnes vers/depuis Supabase sur les deux sens de synchro.
- **Dashboard de synchronisation — visibilité des entrées `t_outbox` en échec définitif** : un badge d'alerte (rouge, affiché uniquement si > 0) affiche désormais le compteur d'entrées passées en `ERROR` après épuisement des tentatives, à côté du nombre d'opérations en attente.
- **Pilotage des Activités de Terrain — 3 évolutions de l'onglet supervision** : l'onglet "Contrôles & Délivrances" compte désormais aussi les délivrances OPERATEUR_VERIFICATION ; le bouton "Actualiser" déclenche une récupération cloud avant de recharger les indicateurs, avec un indicateur "Dernière synchro : il y a X min" ; nouvel onglet "Mon équipe" dans le portail ADMIN_CENTRE (lecture seule de l'activité du jour des agents de son centre).
- **Indicateur de synchronisation Supabase pour l'opérateur, sur "Travail du jour" (Vérification et Saisie)** : un badge par carte (Synchronisé / En attente / Échec côté Vérification) et un récapitulatif agrégé, avec rafraîchissement automatique côté Vérification (30 s). Côté Saisie (workflow 100 % manuel), le libellé ("À synchroniser (admin)") reflète la réalité du circuit sans polling dédié. Validé par audit de non-régression (`agent-9-senior-auditor`) et QA terrain via harnais Playwright isolé.

### 🛠️ Corrections & Sécurité

- **Bouton de synchro restant inactif après une action métier, sur 3 portails** (OPERATEUR_VERIFICATION, OPERATEUR_QUALITE, ADMIN_CENTRE) : le compteur pilotant l'état actif/inactif du bouton n'était jamais recalculé après une délivrance/correction — corrigé sur les 3 portails. Validé par un test e2e dédié.
- **Recherche de carte introuvable en apurement alors que trouvée en vérification, sur le même site** : la recherche apurement utilise désormais le même index FTS5 que la vérification (au lieu d'une correspondance texte stricte), avec tri alphabétique conservé.
- **Accès refusé sur "Identification Guidée" pour OPERATEUR_QUALITE** : ce rôle appelait la même recherche que l'apurement mais n'était pas autorisé côté handler — corrigé.
- **Compteur "ACTIONS DU JOUR" (Contrôles & Délivrances / Mon équipe) comptant toute action journalière** au lieu du seul contrôle qualité/délivrance : seules `CARTE_DELIVREE` et `CMU_MODIFICATION` sont désormais comptées.
- **`database is locked` (SQLITE_BUSY) sur le DownloadWorker pendant un pull de cartes**, provoqué par une collision avec le cycle comptes/rôles (3 min) : le pull manuel pose désormais le même verrou que le cycle automatique de 2h, et le cycle comptes/rôles attend le tick suivant si un downstream est en cours. Un chunk en échec transitoire est désormais retenté automatiquement (2 tentatives, léger backoff).
- **`t_outbox` : entrées en échec définitif (`ERROR`) jamais retentées automatiquement** : retry automatique avec backoff progressif (doublement par tentative, plafonné à 24h) ajouté au cycle périodique et au retour réseau, sans jamais réinitialiser le compteur de tentatives.
- **Retry automatique `t_outbox` (ci-dessus) : les entrées repromues en `PENDING` ne recevaient en réalité jamais de nouvelle tentative réseau** : le garde-fou de seuil de tentatives ne s'applique désormais qu'au chemin rapide/immédiat ; sur le cycle périodique, l'entrée obtient toujours une vraie tentative réseau.
- **4 écritures `t_cartes` ne propageaient jamais leur modification vers Supabase** : `updateApurementHistorique`, `reactiverCarte`, `transfererCarte` et `updateCarteRangementAndStatusRapid` enfilent désormais systématiquement l'écriture vers Supabase après succès local, sur le même modèle que `delivrerCarte`/`signalerAbsence`.
- **6 payloads `t_users` partiels risquant un rejet ou une écriture incomplète côté Supabase** (`resetSiteAdminPassword`, `resetAgentPassword`, `deleteUser`, `deleteSite`/`deleteCentre`, `updateSelfProfile`) : `login`, `password_hash` et `role` sont désormais systématiquement inclus, sans jamais faire de `SELECT *` sur `t_users`.
- **Cartes issues d'un import massif jamais suivies par le circuit de synchro standard** : chaque carte importée est désormais enfilée dans `t_outbox` (même transaction que la fusion du chunk), suivant le même circuit que toute autre écriture de carte ; "Forcer la synchronisation" exclut les cartes déjà en attente pour éviter un double-envoi. Validé par audit de non-régression et QA terrain (import réel, vérification `t_outbox`, non-double-envoi).

### 🧱 Base de Données

- **Migrations `SCHEMA_VERSION` 66 → 68** (additives, aucune perte de données) : `migrateV67` ajoute 7 colonnes de traçabilité doublon sur `t_cartes` (`doublon_declare_par`, `doublon_declare_le`, `doublon_motif`, `statut_avant_doublon`, `doublon_annule_par`, `doublon_annule_le`, `doublon_motif_annulation`) ; `migrateV68` ajoute `last_attempt_at` sur `t_outbox`. Nouveaux handlers IPC `cartes:declarerDoublon` / `cartes:annulerDoublon` avec RBAC serveur strict.

### ⚠️ Points de vigilance connus

- **Schéma Supabase (production) — vérifié conforme avant build** : les 7 colonnes de traçabilité doublon ont été créées sur `public.t_cartes` en production et vérifiées présentes (audit `agent-12-deploy-validator` du 2026-08-17, lecture directe des 7 colonnes). Aucun mécanisme de migration Supabase versionné n'existe encore dans ce dépôt — toute évolution future de schéma nécessitera là aussi une vérification manuelle équivalente avant diffusion.
- Pattern d'identité fournie par le renderer (plutôt que dérivée de la session serveur) repéré sans audit approfondi sur les familles `sync:*`/`database:*`/`cmu:*` — à traiter dans un chantier séparé si souhaité.

---

## [2.14.0] - 2026-08-13

### 🚨 Sécurité (Critique)

- **7 fuites P0 de cloisonnement centre sur le portail ADMIN_CENTRE (jusque-là jamais audité)** : un ADMIN_CENTRE pouvait consulter les données d'autres centres — y compris des informations personnelles (téléphone, numéro CMU) — via une recherche 100% normale, sans forgeage d'appel IPC. Corrigé sur les 7 points d'entrée concernés. Corrige au passage un bug de suppression de log qui ciblait la mauvaise table.

### 🚀 Nouveautés & Ergonomie

- **Portail ADMIN_CENTRE : nouvel onglet "Escalades Résolues"** : quand un ADMIN_CENTRE escalade un signalement d'absence au site, il peut désormais suivre ce qu'il en advient au lieu de perdre toute visibilité après l'escalade. Corrige au passage un bug où une carte déclarée définitivement perdue restait invisible pour l'opérateur d'origine.

### 🛠️ Corrections & Sécurité

- **Cycle signalement/escalade/résolution d'absence de carte ne se propageant en réalité jamais correctement entre plusieurs postes physiques distincts (chantier le plus important de ce cycle)** : plusieurs colonnes manquantes sur le schéma Supabase (production ET test) et trois couches de code (mappers d'envoi ET de réception) omettaient silencieusement des champs métier clés (`escalade_niveau`, `has_invalid_date`, `note_signalement_absence`, `contact_retirant`, `relation_retirant`, champs de résolution). Corrigé et validé de bout en bout entre deux vraies instances Electron via un vrai projet Supabase.
- **Compteur "Télécharger N cartes depuis le Cloud" ne redescendant jamais à 0 après un téléchargement complet :** confusion entre le curseur de sécurité anti-décalage d'horloge et le repère d'affichage. Corrigé, avec rafraîchissement automatique léger toutes les 3 minutes pour refléter les nouvelles cartes ajoutées par un autre poste.

### ⚡ Performances & Optimisations

- **Bouton "Purger les cartes locales de ce PC" figeant l'application ~30 secondes** sur un volume réel (218k+ cartes) : ramené à quelques centaines de ms pour l'essentiel de l'opération (découpage par lots au lieu d'une transaction massive).

### ⚠️ Points de vigilance connus

- Ce cycle s'appuie sur une intervention manuelle déjà effectuée par l'utilisateur sur le schéma Supabase de **PRODUCTION** (ajout des colonnes `escalade_niveau`, `has_invalid_date`, `note_signalement_absence` à `t_cartes` via `ALTER TABLE`) — prérequis déjà satisfait avant ce cycle de développement, aucune action supplémentaire requise.

---

## [2.13.1] - 2026-08-11

### 🛠️ Corrections & Sécurité

- **Migrations SQLite non fiables en cas de données orphelines, avec faux positif "à jour" (incident production réel, 2 postes de terrain) :** `migrateV64` (élargissement du rôle OPERATEUR_APUREMENT) échouait sur des lignes `t_users` orphelines (`site_id`/`centre_id`/`poste_id` pointant vers un site/centre/poste déjà supprimé), déclenchant le filet de secours "reconstruction d'urgence" — lequel rejouait une séquence de migrations tronquée puis tamponnait `user_version` sur la cible complète **avant** d'avoir réellement terminé la reconstruction. Conséquence sur les postes touchés : schéma durablement incomplet (perte des index de performance V60-V62, retour du bug de lenteur du tableau de bord déjà corrigé en v2.11.0) tout en se déclarant faussement "à jour", empêchant toute réparation automatique future.
  - `migrateV64` neutralise désormais elle-même (mise à `NULL`, journalisée) les lignes orphelines avant la vérification des clés étrangères, au lieu d'échouer dessus.
  - Le filet de secours "reconstruction d'urgence" rejoue désormais dynamiquement la vraie séquence de migrations et ne tamponne `user_version` qu'après son succès réel.
  - Nouvelle migration **`migrateV66_structuralIntegrityNet`** (`SCHEMA_VERSION` 65 → 66), appelée inconditionnellement à chaque démarrage : vérifie l'état structurel réel de la base (jamais `user_version` seul) et répare individuellement ce qui manque — permet aux postes déjà touchés par l'incident de s'auto-réparer à la prochaine mise à jour, sans intervention manuelle poste par poste.
- **`deleteSite()` / `deleteCentre()` (Gestion des sites/centres) laissaient des comptes utilisateurs orphelins :** `deleteSite()` excluait déjà les comptes SUPER ADMIN du `DELETE` mais ne les nettoyait jamais ; `deleteCentre()` ne touchait `t_users` dans aucun cas. Les deux neutralisent désormais les comptes restants (au lieu de les laisser pointer dans le vide) ; `deleteCentre()` est aussi rendue transactionnelle pour la première fois.

### 🧪 Infrastructure de Test

- Couverture e2e dédiée (agent-13 QA terrain, verdict GO, 0 P0/P1) : poste sain sans régression, simulation exacte de l'état réel du poste de production affecté (réparation automatique confirmée sans reconstruction d'urgence), orphelins injectés (neutralisation confirmée avant le `foreign_key_check`), et `deleteSite`/`deleteCentre` via l'UI réelle.

---

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
