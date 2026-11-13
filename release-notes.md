# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité

- **Protection des comptes SUPER ADMIN sur le serveur.** Le serveur refuse désormais, sans bloquer la synchronisation des postes, toute tentative de créer un SUPER ADMIN actif, de transformer un compte en SUPER ADMIN, de changer le mot de passe ou l'identifiant d'un SUPER ADMIN, ou de le supprimer. Chaque tentative est notée dans un journal réservé à l'administrateur. Conséquence temporaire : un SUPER ADMIN créé, ou un mot de passe SUPER ADMIN changé depuis un poste, reste valable sur ce poste mais doit être validé par l'administrateur pour s'appliquer aux autres postes.
- **Garde-fou des cartes délivrées en service.** Une carte déjà délivrée ne peut plus être remise « en stock » par un poste qui revient en ligne avec une ancienne copie.
