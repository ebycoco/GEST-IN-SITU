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
