# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité

- **Protection des comptes SUPER ADMIN sur le serveur.** Le serveur refuse désormais, sans bloquer la synchronisation des postes, toute tentative de créer un SUPER ADMIN actif, de transformer un compte en SUPER ADMIN, de changer le mot de passe ou l'identifiant d'un SUPER ADMIN, ou de le supprimer. Chaque tentative est notée dans un journal réservé à l'administrateur. Conséquence temporaire : un SUPER ADMIN créé, ou un mot de passe SUPER ADMIN réinitialisé depuis un poste, doit être validé par l'administrateur sur le serveur. Sans cette validation, le compte ou le nouveau mot de passe ne fonctionne nulle part, même sur le poste qui l'a créé, après le prochain redémarrage.
- **Garde-fou des cartes délivrées en service.** Une carte déjà délivrée ne peut plus être remise « en stock » par un poste qui revient en ligne avec une ancienne copie.

## 🛠️ Corrections & Fiabilité

- **Rôles des agents conservés lors de l'envoi au serveur.** Quand on ajoute un rôle à un agent, le rôle qu'il avait déjà n'est plus perdu sur le serveur. Les autres postes reçoivent désormais l'agent avec tous ses rôles, et si un envoi échoue, les rôles attendent au lieu d'être effacés.
