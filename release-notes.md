# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **« Forcer la synchronisation » n'annonce plus un succès à tort** — quand aucun site n'était actif sur le poste, le bouton répondait « Synchronisation terminée avec succès » sans rien envoyer. Il vide désormais la file d'envoi dans ce cas, et si des éléments restent en attente il le dit clairement (« Synchronisation partielle : N élément(s) restent en attente d'envoi »). Les cartes en attente d'envoi manuel ne sont pas comptées dans ce message.
