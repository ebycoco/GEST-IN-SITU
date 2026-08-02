# GEST-IN-SITU — Correctifs post-v2.9.0 (non publiés)

> **Date :** 2 août 2026
> **Statut :** Correctifs validés par tests e2e réels (build isolé + projet Supabase de dev dédié), en attente de publication formelle (version/SCHEMA_VERSION à trancher par le release manager)

## 🔴 Corrections critiques (P0)

- **Délivrance/transfert de carte interrompus par une corruption FTS5 non rattrapée** (`SqliteError: database disk image is malformed`) : `delivrerCarte()` et `transfererCarte()` appliquent désormais le même mécanisme d'auto-guérison que `updateCarte()` (suppression du trigger fautif, rejeu sûr de la transaction, reset FTS5 en tâche de fond). Confirmé sans perte de donnée sur 15+ répétitions réelles avant/après correctif.
- **Délivrances de cartes jamais remontées vers Supabase** (bug présent en production depuis le 22/07) : `delivrerCarte()`, `resoudreAbsence()`, `signalerAbsence()`, `autoEnqueueCorrection()` et la fusion de cartes (module Qualité) enfilaient un payload outbox minimal ou déjà transformé, rejeté systématiquement par la validation `site_id` côté envoi. Les cinq points enfilent désormais la ligne carte complète et fraîche.
- **Fuite de lecture cross-site sur le portail Qualité** : 12 endpoints de listing/recherche (doublons, données manquantes, dates invalides, recherche universelle) transmettaient le `site_id` reçu du client directement à la requête SQL, sans vérifier qu'il correspondait à l'utilisateur connecté — un opérateur Qualité pouvait consulter noms, dates de naissance, numéros de sécurité sociale et contacts d'un autre site en falsifiant ce paramètre. Tous les endpoints recadrent désormais systématiquement sur le site réel de l'utilisateur (sauf SUPER ADMIN).
- **Panneau de correction Qualité structurellement bloqué sur une fiche à date de naissance invalide** : toute correction (y compris d'un champ sans rapport, ex. numéro de sécurité sociale) échouait car le composant resoumettait systématiquement la date affichée dans un format non conforme. Corrigé — le champ date n'est plus resoumis s'il n'a pas été modifié, et normalisé au bon format sinon.

## 🟠 Corrections importantes (P1)

- `upload-worker.js` (bouton "Synchroniser mes actions") omettait 9 champs (dont `agent_signalement_absence`) par rapport au mapping standard — traçabilité des signalements d'absence perdue si ce chemin faisait le premier envoi. Champs alignés, confirmé sur Supabase dev.
- Journal d'audit des corrections Qualité (numéro de sécurité sociale, contact) affiché en clair sur deux chemins de sauvegarde — masquage désormais appliqué de façon cohérente sur les deux.
- Bouton "Récupérer depuis le Cloud" du portail Qualité restait actif malgré un cloud injoignable (même défaut déjà corrigé sur le portail Vérification, propagé ici).
- Saisie perdue silencieusement dans les écrans de correction Qualité (Données Manquantes, Autres Anomalies) quand une validation échouait — le champ reste désormais ouvert avec la valeur saisie intacte.
- Indicateur "corrections en attente" restait affiché à tort après une fusion de doublons pourtant synchronisée avec succès (`is_dirty` jamais remis à 0 sur ce chemin) — corrigé, avec la même correction étendue à `t_sites`/`t_centres`.
- Notification de résolution de signalement renvoyait vers une route inexistante (écran blanc, navigation perdue) — corrigée vers `/agent-verification/signalements?tab=resolus`, avec ouverture directe de l'onglet "Résolus".
- Statistiques "Aujourd'hui"/"Hier" du portail de vérification toujours à 0 (comparaison de date incompatible avec l'horodatage réel) — corrigé.
- Bouton "Récupérer depuis le Cloud" restait actif quand le cloud était injoignable (sentinelle d'erreur mal interprétée) — corrigé.
- Badge "Escaladée au Site" ne s'affichait jamais (comparaison sur une valeur jamais écrite en base) — corrigé.
- Écran "Base de données locale vide" ne s'affichait jamais pour le rôle Opérateur Vérification — corrigé.

## 🚀 Nouveautés

- Portail Qualité : indicateur "Cartes disponibles en local" dans l'en-tête, identique à celui déjà présent sur le portail Vérification.

## 🟡 Optimisations & fiabilité (P2)

- Onglet "Résolus" ne se rafraîchissait pas automatiquement à la réception d'une résolution si déjà ouvert — écoute désormais l'événement de synchro en temps réel.
- Écran de recherche de vérification pouvait afficher un flash transitoire "base vide" juste après une création de carte — course entre deux effets React corrigée.
- Compteur "cartes cloud disponibles" sans retry en cas d'échec réseau transitoire — ajout d'un retry borné, et indicateur "À jour" après un pull réussi pour clarifier la fenêtre de marge du repère de synchro.
- Double déclenchement de l'événement `ready-to-show` au démarrage (doublait l'initialisation du moteur de synchro) — corrigé.
- Gardes `PRAGMA foreign_keys` et verrou de réentrance ajoutés autour des upserts site/centre du cycle de tirage descendant.

## 🧪 Infrastructure de test

Mise en place d'une suite e2e Playwright isolée (`e2e/`), avec base SQLite jetable par run et garde-fou dédié empêchant tout accès accidentel au Supabase de production. Couverture ajoutée : parcours complet des rôles Opérateur Vérification (recherche, délivrance, signalements, cloisonnement site/centre) et Opérateur Qualité (doublons, données manquantes, dates invalides, anomalies brutes, recherche universelle, cloisonnement site), et scénarios de synchro cloud réelle (hors-ligne → envoi → récupération inter-postes) contre un projet Supabase de développement dédié.

---

# GEST-IN-SITU — Release v2.9.0

> **Date de publication :** 30 juillet 2026  
> **Statut :** Production — Postes opérationnels en Côte d'Ivoire  
> **SCHEMA_VERSION :** 59 (inchangé — aucune migration BDD requise)

---

## 🚀 Nouveautés & Ergonomie

### Module Qualité — Onglet "Autres Anomalies"
Nouvel onglet dédié sur la page Qualité permettant de consulter, filtrer et corriger les cartes dont le statut est inconnu (ex : `ERREUR`, `NUMERO INCORRECT`, `INJOIGNABLE`). L'agent peut désormais :
- Visualiser toutes les cartes à statut non reconnu en un seul endroit
- Ouvrir le panneau de correction rapide (`CorrectionSidePanel`)
- Voir le détail expandable de chaque carte (`ExpandedAnomalyDetails`)

### Module Qualité — Données Manquantes Expandable
Intégration du composant `ExpandedManquantDetails` sur l'onglet "Données Manquantes" pour un affichage carte par carte des champs absents, avec action de correction directe depuis la liste.

### Nouvelles Métriques KPI — Tableau de Bord Admin
Deux nouveaux indicateurs sont affichés dans le tableau de bord :
- **Autres Anomalies** : nombre de cartes à statut inconnu
- **Dates Vides** : nombre de cartes sans date de naissance

Chaque KPI est cliquable et redirige directement vers l'onglet de correction correspondant.

### Import Sécurisé — Validation des Statuts
Lors de l'import CSV/Excel, seul `DOUBLON` est accepté comme statut alternatif à `DELIVRE` ou `EN STOCK`. Les statuts terrain non standard (`NUMERO INCORRECT`, `INJOIGNABLE`, `ERREUR`) sont désormais :
- Rejetés silencieusement
- Tracés comme `STATUT_INCONNU`
- La carte est sauvegardée en stock avec un message d'avertissement précisant le statut exact en **gras**

### Bouton "Forcer en Stock" repositionné
Le bouton est désormais intégré à l'intérieur du panneau de détail de la carte, conformément à l'ergonomie terrain attendue.

---

## 🛠️ Corrections & Sécurité

- **Outbox Upstream :** Robustesse accrue pour les opérations en attente lors d'interruptions réseau
- **Download Worker :** Meilleure gestion des conflits de fusion lors du tirage descendant
- **Heartbeat de Session :** Prévention des déconnexions intempestives
- **Requêtes Hiérarchie & Import :** Fiabilisation du pipeline d'import multi-formats

---

## ⚡ Optimisations

- Suppression de 3 pages obsolètes (`AdminCentreDashboardPage`, `AnomaliesView`, `QualiteAssainissementPage`)
- Nouveau hook `useDebounce` limitant les appels IPC dans les barres de recherche
- Refactorisation du store Zustand `qualityUIStore`

---

## ℹ️ Mise à jour automatique

Cette release est distribuée via le système d'auto-update Electron.  
Les postes connectés recevront la notification de mise à jour automatiquement.  
**Aucune action manuelle n'est requise sur les centres en production.**
