# GEST-IN-SITU — Prochaine version (non publiée)

## 🚀 Nouveautés & Ergonomie
- **Versions des postes (préparation)** : chaque poste reçoit un identifiant unique et déclare sa version en arrière-plan (20 s après l'ouverture et après chaque connexion, au plus une fois par heure, jamais en mode développement, sans aucun ralentissement du démarrage). Le cœur de l'application sait lire la liste des postes, réservée au SUPER ADMIN (contrôle du rôle actif côté serveur) ; noms de sites et d'utilisateurs retrouvés sur le poste, jamais transmis par le cloud. L'écran viendra ensuite. Envoi aussi toutes les 12 h (un poste resté ouvert n'apparaît plus « silencieux » à tort), numéro de poste protégé contre un blocage momentané du fichier (antivirus), déclaration de connexion jamais perdue pendant un envoi en cours.

- **Écran « Versions des postes » (SUPER ADMIN)** : nouvelle page, dans le menu, qui montre pour chaque poste sa version, son site, son état (à jour, en retard, inconnu, silencieux depuis plus de 7 jours), sa dernière remontée et le dernier utilisateur connu, avec synthèse, filtres par site et par état, et bouton Actualiser. Plus besoin d'aller dans Supabase. Seuls les postes ayant installé cette version se déclarent. Tableau lisible sur les petits écrans (un seul défilement, bandeau repliable), tri au clic sur les colonnes, anciennes données conservées (grisées, restant lisibles) si l'actualisation échoue ; la colonne « Première vue » se masque sur les écrans étroits.

## 🛠️ Corrections & Fiabilité
- **Tests** : le test « horloge reculée » de la sauvegarde quotidienne ne dépend plus de l'heure à laquelle il est lancé (il échouait avant midi).
