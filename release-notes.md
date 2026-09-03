# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité

- **Correction d'une fuite de cloisonnement site sur le portail Qualité (transfert d'une anomalie d'import vers une carte)** : le panneau de correction global ne vérifiait jamais que l'anomalie corrigée appartenait bien au site de l'opérateur avant de créer la carte correspondante, permettant potentiellement de transférer des données d'un autre site.

## 🚀 Nouveautés & Ergonomie

- **Assistant d'identification guidée (portail Qualité) : les boutons d'action restent désormais visibles en pied de fenêtre** au lieu de défiler avec le contenu, notamment utile sur les petites résolutions terrain.

## 🛠️ Corrections & Fiabilité

- **Validation du format du numéro de sécurité sociale (13 chiffres) et du contact (10 chiffres) désormais appliquée sur le panneau de correction global du portail Qualité** (fusion de doublons, dates invalides, recherche universelle) — ces contrôles existaient déjà pour la complétion de données manquantes mais pas sur ce circuit.
- **Champ "Rangement" désormais modifiable depuis l'onglet "Autres Anomalies" du portail Qualité** : la sauvegarde échouait systématiquement (champ non autorisé côté serveur) malgré sa présence dans l'interface.
- **Validation de format (numéro de sécurité sociale, contact) désormais appliquée à la correction d'une anomalie brute** (onglet "Autres Anomalies"), alignée sur les autres circuits de correction du portail Qualité.
- **Fiabilise l'enregistrement de certaines corrections de cartes qualité (suppression, transfert d'anomalie)** : la mise à jour de la base locale et son enfilage vers la synchronisation cloud s'exécutent désormais de façon atomique, réduisant le risque qu'une correction reste bloquée localement sans jamais être transmise en cas d'incident.
- **Récupération manuelle des cartes depuis le cloud ("RÉCUPÉRER LES CARTES DEPUIS LE CLOUD") : un compte dont le site référence un identifiant introuvable côté Supabase affichait à tort "Vos données locales sont déjà à jour"** au lieu d'un message actionnable. Un message explicite ("Site introuvable côté cloud — contactez le SUPER ADMIN") s'affiche désormais dans ce cas précis.
- **Les corrections unitaires de carte (portail Qualité, panneau de correction) ne remontaient jamais automatiquement vers Supabase lorsque le toggle "Envoi Automatique" du compte était désactivé** — ce qui est le cas par défaut pour tout compte connecté avec le rôle actif Administrateur de Site, censé protéger uniquement les imports massifs. L'envoi immédiat d'une correction unitaire est désormais forcé indépendamment de ce toggle, sans affecter la protection existante des imports massifs (cycle périodique et retour réseau inchangés).
- **Le même correctif est étendu à 4 autres mutations unitaires de carte** (correction/annulation d'un émargement Apurement, rangement issu du scan d'inventaire physique) : elles ne remontaient elles non plus jamais automatiquement vers Supabase lorsque le toggle "Envoi Automatique" était désactivé. Le texte du toggle (page Profil) et la documentation interne du moteur de synchronisation ont été précisés en conséquence.
- **Le même correctif est étendu à 5 mutations unitaires de carte supplémentaires** (suppression, délivrance, déclaration de doublon, annulation d'une déclaration de doublon, transfert de carte entre centres) : elles ne remontaient elles non plus jamais automatiquement vers Supabase lorsque le toggle "Envoi Automatique" était désactivé. La publication groupée de brouillons (`publishDrafts`), qui peut traiter plusieurs cartes en un seul appel, est volontairement restée soumise au toggle pour préserver la protection Low-Memory sur les opérations de volume.
- **La publication de brouillons (`publishDrafts`) applique désormais un seuil de 5 cartes** : une publication ponctuelle (5 cartes ou moins) force elle aussi l'envoi immédiat vers Supabase comme les autres mutations unitaires, tandis qu'une publication de lot (plus de 5 cartes) reste soumise au toggle "Envoi Automatique" pour préserver la protection Low-Memory sur les opérations de volume.
- **Correction d'une rare fenêtre de course pouvant laisser une correction unitaire de carte bloquée en attente d'envoi (`t_outbox`) malgré l'envoi immédiat forcé** : si un traitement de la file d'attente était déjà en cours au moment précis où une nouvelle correction demandait son envoi immédiat (ex. correction Qualité juste après la création de la carte), la demande était jusqu'ici silencieusement ignorée sans être rejouée — révélé par un test end-to-end cloud vivant (agent-13-qa-terrain-tester). Un tel appel déclenche désormais systématiquement un nouveau passage immédiat dès la fin du traitement en cours.

## ⚡ Performances
