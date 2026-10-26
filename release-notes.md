# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **« Forcer la synchronisation » n'annonce plus un succès à tort** — quand aucun site n'était actif sur le poste, le bouton répondait « Synchronisation terminée avec succès » sans rien envoyer. Il vide désormais la file d'envoi dans ce cas, et si des éléments restent en attente il le dit clairement (« Synchronisation partielle : N élément(s) restent en attente d'envoi »). Les cartes en attente d'envoi manuel ne sont pas comptées dans ce message.

- **Correction d'une date de naissance (Qualité) : le format JJ/MM/AAAA est converti** — une date saisie au format JJ/MM/AAAA dans les écrans de correction était enregistrée telle quelle : la carte devenait introuvable par nom et date à la vérification, et revenait sans fin dans « Dates invalides ». Elle est désormais convertie au format AAAA-MM-JJ avant l'enregistrement, et une date impossible (par exemple 31/02/1990) est refusée avec un message clair. Les cartes déjà enregistrées au mauvais format restent à corriger une fois depuis l'écran « Dates invalides ».
