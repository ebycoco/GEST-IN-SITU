# GEST-IN-SITU — Prochaine version (non publiée)

## 🚀 Nouveautés & Ergonomie
- **Versions des postes (préparation)** : chaque poste reçoit un identifiant unique et déclare sa version en arrière-plan (20 s après l'ouverture et après chaque connexion, au plus une fois par heure, jamais en mode développement, sans aucun ralentissement du démarrage). Le cœur de l'application sait lire la liste des postes, réservée au SUPER ADMIN (contrôle du rôle actif côté serveur) ; noms de sites et d'utilisateurs retrouvés sur le poste, jamais transmis par le cloud. L'écran viendra ensuite.

## 🛠️ Corrections & Fiabilité
- **Tests** : le test « horloge reculée » de la sauvegarde quotidienne ne dépend plus de l'heure à laquelle il est lancé (il échouait avant midi).
