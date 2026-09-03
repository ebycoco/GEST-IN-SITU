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

## ⚡ Performances
