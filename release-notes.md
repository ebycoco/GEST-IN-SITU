# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.18.0, 24 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🚨 Sécurité

- Correction d'une faille de contrôle d'accès sur la réinitialisation du mot de passe d'un administrateur de site : cette action, censée être réservée au SUPER ADMIN, était accessible sans aucune vérification de rôle, permettant potentiellement à n'importe quel compte authentifié de réinitialiser le mot de passe de l'administrateur d'un site quelconque.

## 🛠️ Corrections & Fiabilité

- Suppression d'un site : les entrées de la file de synchronisation (outbox) des centres, agents et rôles rattachés au site supprimé sont désormais correctement nettoyées, évitant qu'ils ne soient recréés côté cloud lors de la prochaine synchronisation.
- Suppression d'un site ou d'un centre : élimination d'une fenêtre de course avec la synchronisation en cours qui pouvait, dans de rares cas, laisser une entité supprimée localement réapparaître depuis le cloud lors d'une synchronisation ultérieure.
- Contexte multi-site (SUPER ADMIN) : le sélecteur de site de la barre latérale se met désormais à jour immédiatement après création d'un site (sans nécessiter de reconnexion), et revient automatiquement à la vue globale si le site actuellement sélectionné vient d'être supprimé.
- Journal d'audit : la création/modification d'un site ou d'un centre est désormais tracée (auparavant seule la suppression l'était), et la réinitialisation du mot de passe d'un agent y apparaît également. Corrige aussi une entrée d'audit qui affichait "Login: Inconnu" lors de la modification d'un agent.
- Un centre nouvellement créé apparaît désormais correctement dans le compteur "à synchroniser" de la page Infrastructures, au lieu d'être ignoré tant qu'aucune autre modification ne le touche.
- Un centre rattaché à un site dont l'accès a été révoqué affiche désormais un statut "SITE RÉVOQUÉ" au lieu du badge "OPÉRATIONNEL" affiché à tort quel que soit l'état réel du site.
- Licence de site expirée ou accès suspendu : une session déjà ouverte est désormais fermée automatiquement (dans les 3 minutes) avec un message explicite, au lieu de continuer à fonctionner indéfiniment. Une nouvelle tentative de connexion affiche également le motif réel ("licence expirée" / "accès suspendu") au lieu du message générique "Identifiants incorrects".
