# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité

## 🚀 Nouveautés & Ergonomie

## 🛠️ Corrections & Fiabilité

- Modification de la date d'expiration de licence d'un site (SUPER ADMIN) : le changement ne se synchronisait jamais vers Supabase — il échouait silencieusement à cause d'un identifiant local erroné inclus dans la charge utile envoyée au cloud, et était néanmoins marqué à tort comme synchronisé. Corrigé, aligné sur le comportement déjà correct de la mise à jour d'un centre.
- Import de cartes suivi d'un envoi vers le cloud : le nombre réel de cartes transmises (ou en échec) via la file d'attente de synchronisation n'était jamais remonté à l'utilisateur, pouvant afficher à tort "0 carte envoyée" alors que des cartes étaient en réalité traitées en arrière-plan. Le message affiché inclut désormais le nombre exact de cartes transmises/en échec/en attente, ainsi que l'état du réseau si un blocage persiste.

## ⚡ Performances
