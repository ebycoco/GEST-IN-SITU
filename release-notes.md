# GEST-IN-SITU — Prochaine version (non publiée)

## ⚡ Performances
- **Ouverture plus rapide** : le contrôle complet de l'index de recherche ne bloque plus le démarrage (environ 13 s gagnées à froid sur disque lent). Il tourne désormais en arrière-plan, au plus une fois par semaine, avec réparation automatique conservée. Il est reporté automatiquement pendant une synchronisation, un import ou une purge, pour ne pas figer l'application en plein travail.
- **Écran de démarrage visible tout de suite** : le logo s'affiche dès le double-clic, avant la préparation de la base, au lieu de rester invisible pendant l'attente.
- **Sauvegarde automatique une fois par jour** : elle n'est plus faite à chaque ouverture (environ 80 s de disque occupé juste après la connexion), mais seulement si la dernière a plus de 24 h, 10 min après l'ouverture et jamais pendant une synchronisation, un import ou une purge (sauf si aucune sauvegarde depuis 48 h).

## 🛠️ Corrections & Fiabilité
- **Historique des sauvegardes fiable** : on garde désormais une sauvegarde par jour sur les 7 derniers jours, au lieu des 7 derniers fichiers (7 ouvertures effaçaient tout l'historique). Une sauvegarde interrompue n'est plus jamais prise pour une sauvegarde valide.
- **Sauvegardes robustes** : une horloge de poste qui recule ne bloque plus les sauvegardes automatiques ; première sauvegarde après 2 min si aucune sauvegarde récente ; en cas d'échec (disque plein, fichier bloqué par l'antivirus), nouvel essai du renommage puis attente de 6 h au lieu d'une copie complète toutes les heures.
