# GEST-IN-SITU v2.8.0 — Notes de Release

**Date de publication :** 30 juillet 2026
**Validée par :** Agent 12 (Deploy Validator) ✅
**Documentée par :** Agent 11 (Release Manager) ✅

---

## 🚀 Nouvelles Fonctionnalités

- **Détection des Cartes Fantômes :** Nouveau compteur et nouvelle étape dédiée (Étape 3, avant le blocage des dates invalides) pour les cartes locales dont l'identité est totalement vide (nom, prénom, numéro de sécu et rangement tous absents) — jusqu'ici invisibles de tous les indicateurs et jamais synchronisables. Un clic renvoie directement vers la page Qualité pour correction.
- **Enfilage Automatique des Corrections Qualité :** Les corrections individuelles (date de naissance, champs rapides, rangement) sont désormais poussées vers le Cloud quasi instantanément si une connexion est disponible, avec garde de conformité (aucun envoi automatique si la carte a encore un doublon ou une date invalide non résolue).

## 🛠️ Corrections & Sécurité

- **Tirage Descendant (Anti-Perte de Données) :** Le repère de synchronisation (watermark) n'est plus écrasé par l'heure locale du poste après le cycle automatique de 2h ; une marge de sécurité absorbe désormais un décalage d'horloge résiduel côté poste expéditeur, éliminant un risque de carte jamais détectée par les autres postes.
- **Sécurité IPC :** Le endpoint `sync:getCloudCartesCount` applique maintenant le même contrôle d'accès site/rôle que les autres endpoints de synchronisation.
- **Horodatage à l'Envoi :** Les cartes envoyées en masse portent désormais l'heure réelle d'envoi, garantissant leur détection par les autres postes lors d'un tirage ultérieur.
- **Purge Cloud Résiliente :** Ajout d'une reprise automatique (retry) sur incident réseau transitoire lors de la purge Cloud.
- **Cohérence Badge/Envoi (Saisie, Vérification, Admin Centre) :** Le bouton d'envoi n'active plus sur des cartes que le filtre de conformité rejetterait silencieusement au moment de l'envoi réel.
- **Total Cartes :** Le KPI reflète désormais le nombre réel de cartes locales, sans y ajouter les anomalies encore en attente de correction.

## 🧹 Nettoyage

- Suppression de boutons non fonctionnels (gestionnaire IPC manquant) et du code mort lié à l'ancien mécanisme de synchronisation par file d'attente (`t_sync_queue`).

---

*GEST-IN-SITU — Application desktop offline-first de gestion des cartes CMU — Centre Abobo*
