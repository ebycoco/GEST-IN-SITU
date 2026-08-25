# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.18.0, 24 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🚨 Sécurité

- Correction d'une faille de contrôle d'accès sur la réinitialisation du mot de passe d'un administrateur de site : cette action, censée être réservée au SUPER ADMIN, était accessible sans aucune vérification de rôle, permettant potentiellement à n'importe quel compte authentifié de réinitialiser le mot de passe de l'administrateur d'un site quelconque.
- Correction d'une faille similaire sur le nettoyage des incohérences qualité (cartes sans numéro de sécu/sans rangement) : accessible sans vérification de rôle ni de site, permettant potentiellement à n'importe quel compte authentifié de supprimer en masse des données d'un site autre que le sien.
- Correction d'une faille sur les exports de cartes (CSV/Excel/PDF) : accessibles sans vérification de rôle, avec un filtrage par site optionnel, permettant potentiellement à n'importe quel compte authentifié d'exporter les données nominatives (dont le numéro CMU) de tous les sites au lieu du seul site autorisé.
- Correction d'une faille sur la purge du journal d'audit : accessible sans vérification de rôle (seule protection : une confirmation visuelle côté interface, pas une barrière serveur), permettant potentiellement à n'importe quel compte authentifié d'effacer irréversiblement tout l'historique d'audit de l'application.
- Correction d'une faille sur le nettoyage des données temporaires d'import : accessible sans vérification de rôle ni de site, même lacune que celle déjà corrigée sur le nettoyage des incohérences qualité.
- Correction de quatre lacunes RBAC supplémentaires (moins critiques) : synchronisation globale forcée accessible à un rôle autre que SUPER ADMIN, résumé des sites exposant les identifiants d'administrateurs de tous les sites, purge des logs système protégée par mot de passe mais pas par rôle, et modification de la configuration système sans aucune vérification.

## 🚀 Nouveautés & Ergonomie

- Import de cartes (Centre de Migration) : réimporter un fichier corrigé pour un site déjà importé complète désormais automatiquement les champs manquants des cartes déjà existantes (numéro de sécu, lieu d'enrôlement, rangement, et — quand le numéro de sécu permet une identification fiable et non ambiguë — nom, prénom, date de naissance, lieu de naissance, contact), sans jamais écraser une valeur déjà renseignée et sans jamais modifier le statut d'une carte déjà traitée sur le terrain (délivrée/déchargée).
- Module Qualité → Données Manquantes : ajout d'un onglet "Sans Lieu Enrôl." permettant de compléter le lieu d'enrôlement d'une carte, seul champ qui n'avait jusqu'ici aucune voie de correction (ni automatique ni manuelle).
- Ajout d'un sélecteur de rôle actif dans la barre supérieure : un utilisateur possédant plusieurs rôles peut désormais basculer instantanément entre ses rôles accordés (ex. opérateur d'apurement ↔ opérateur de vérification) sans se déconnecter ni ressaisir ses identifiants. Une confirmation est demandée avant chaque bascule, puis l'application redirige automatiquement vers l'interface du rôle choisi.

## 🛠️ Corrections & Fiabilité

- Import de cartes (Centre de Migration) : une ligne totalement vide du fichier importé (nom, prénom, date de naissance, numéro de sécu, lieu de naissance, contact, lieu d'enrôlement, statut et date de délivrance tous vides) n'est désormais plus importée du tout, au lieu de créer une "carte fantôme" avec un rangement automatiquement mis à "non classé". Les imports partiels légitimes (au moins une donnée réelle renseignée) restent inchangés.
- Journal d'audit : la traçabilité des changements de rôle actif (`ROLE_SWITCH`) enregistre désormais correctement le rôle réellement actif juste avant chaque bascule, au lieu d'afficher à tort le rôle de connexion initial dès la deuxième bascule d'une même session.
- Suppression d'un site : les entrées de la file de synchronisation (outbox) des centres, agents et rôles rattachés au site supprimé sont désormais correctement nettoyées, évitant qu'ils ne soient recréés côté cloud lors de la prochaine synchronisation.
- Suppression d'un site ou d'un centre : élimination d'une fenêtre de course avec la synchronisation en cours qui pouvait, dans de rares cas, laisser une entité supprimée localement réapparaître depuis le cloud lors d'une synchronisation ultérieure.
- Contexte multi-site (SUPER ADMIN) : le sélecteur de site de la barre latérale se met désormais à jour immédiatement après création d'un site (sans nécessiter de reconnexion), et revient automatiquement à la vue globale si le site actuellement sélectionné vient d'être supprimé.
- Journal d'audit : la création/modification d'un site ou d'un centre est désormais tracée (auparavant seule la suppression l'était), et la réinitialisation du mot de passe d'un agent y apparaît également. Corrige aussi une entrée d'audit qui affichait "Login: Inconnu" lors de la modification d'un agent.
- Un centre nouvellement créé apparaît désormais correctement dans le compteur "à synchroniser" de la page Infrastructures, au lieu d'être ignoré tant qu'aucune autre modification ne le touche.
- Un centre rattaché à un site dont l'accès a été révoqué affiche désormais un statut "SITE RÉVOQUÉ" au lieu du badge "OPÉRATIONNEL" affiché à tort quel que soit l'état réel du site.
- Licence de site expirée ou accès suspendu : une session déjà ouverte est désormais fermée automatiquement (dans les 3 minutes) avec un message explicite, au lieu de continuer à fonctionner indéfiniment. Une nouvelle tentative de connexion affiche également le motif réel ("licence expirée" / "accès suspendu") au lieu du message générique "Identifiants incorrects".
