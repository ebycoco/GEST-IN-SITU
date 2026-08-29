# GEST-IN-SITU — Prochaine version (non publiée)

## 🚨 Sécurité

## 🚀 Nouveautés & Ergonomie

- La bannière d'alerte d'expiration de licence adresse désormais une consigne différente selon le profil : l'administrateur du site est invité à contacter le super administrateur, tandis que les autres utilisateurs (opérateurs, etc.) sont invités à en informer l'administrateur de leur site.

## 🛠️ Corrections & Fiabilité

- Modification de la date d'expiration de licence d'un site (SUPER ADMIN) : le changement ne se synchronisait jamais vers Supabase — il échouait silencieusement à cause d'un identifiant local erroné inclus dans la charge utile envoyée au cloud, et était néanmoins marqué à tort comme synchronisé. Corrigé, aligné sur le comportement déjà correct de la mise à jour d'un centre.
- Import de cartes suivi d'un envoi vers le cloud : le nombre réel de cartes transmises (ou en échec) via la file d'attente de synchronisation n'était jamais remonté à l'utilisateur, pouvant afficher à tort "0 carte envoyée" alors que des cartes étaient en réalité traitées en arrière-plan. Le message affiché inclut désormais le nombre exact de cartes transmises/en échec/en attente, avec un message explicite indiquant la marche à suivre lorsque la connexion est jugée définitivement indisponible.
- Réduit le risque qu'une connexion terrain lente (réseau mobile dégradé) soit détectée à tort comme totalement hors-ligne au démarrage de l'application : le délai accordé à chaque tentative de connexion est désormais plus tolérant.
- Un envoi manuel vers le cloud (après un import) revérifie désormais réellement l'état de la connexion juste avant de transmettre, au lieu de se fier uniquement à un état mis en cache pouvant être obsolète.
- Création d'un site : choisir un identifiant déjà utilisé par un autre compte affiche désormais un message clair au lieu d'une erreur technique brute.
- Corrige des erreurs répétées en arrière-plan liées au suivi de présence d'un compte SUPER ADMIN ou administrateur de site rattaché à un site orphelin (supprimé ou jamais synchronisé) — sans impact visible pour l'utilisateur, mais générait du bruit continu dans les journaux techniques.

## ⚡ Performances
