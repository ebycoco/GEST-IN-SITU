# GEST-IN-SITU — Release v2.20.0 (2026-08-26)

## 🚨 Sécurité

## 🚀 Nouveautés & Ergonomie

- Ajout d'une bannière d'alerte préventive lorsque la licence d'un site approche de son expiration (3 jours ou moins) : affichée automatiquement à tous les utilisateurs connectés sur ce site, quel que soit leur poste, avec la date exacte d'expiration. Fermable, mais réapparaît périodiquement (toutes les 5 minutes, toutes les minutes pour l'administrateur du site) tant que la licence n'est pas renouvelée — remplace l'ancien avertissement ponctuel qui ne s'affichait qu'une seule fois à la connexion.

## 🛠️ Corrections & Fiabilité

- Écran de connexion : les erreurs (identifiant/mot de passe incorrect, licence de site expirée, accès au site suspendu) s'affichent désormais dans une fenêtre modale explicite au lieu d'une simple notification temporaire facilement manquée, avec réinitialisation automatique du champ mot de passe après une erreur de saisie.
- Corrige un bug empêchant l'affichage du bon message d'erreur à la connexion (licence expirée / accès suspendu) : l'enveloppe technique ajoutée par Electron autour du message d'erreur du processus principal faisait échouer sa détection côté interface, ce qui provoquait à tort l'affichage d'un message générique "Erreur de connexion".

## ⚡ Performances
