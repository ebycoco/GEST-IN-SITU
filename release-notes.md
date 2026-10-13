# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **Mises à jour : recherche automatique toutes les 4 heures** — l'application ne cherchait une nouvelle version qu'une seule fois, 10 secondes après son ouverture ; un poste resté ouvert plusieurs jours n'en trouvait donc pas de plus récente et semblait avancer version par version. Elle vérifie maintenant périodiquement (sans doublon, erreur réseau silencieuse hors ligne) et le poste récupère directement la dernière version publiée.

- **Synchronisation des comptes : les comptes ignorés sont désormais expliqués dans le journal** — quand un téléchargement des comptes laisse de côté un compte (modification locale en attente, envoi en cours, compte supprimé, ou ligne locale plus récente que la lecture cloud), le journal indique le login et la raison exacte, ce qui facilite le diagnostic sur le terrain. Aucun mot de passe n’est journalisé et le volume est plafonné.

### 🚀 Nouveautés & Ergonomie

- **Panneau de succès animé pour les validations importantes** — après une délivrance de carte, un import réussi ou la publication de brouillons, un petit panneau avec une coche animée remplace le message furtif : « Carte délivrée avec succès ! », « Import terminé » ou « N brouillon(s) publié(s) ». Il s'affiche en bas à gauche de la zone de travail (sans recouvrir le menu), disparaît seul après 4 secondes, reste affiché tant que la souris ou le clavier est dessus, se ferme avec la croix ou Échap, et respecte le réglage « réduire les animations » de Windows. Les messages d'erreur et d'avertissement restent inchangés.

- **Mise à jour : bouton « Installer maintenant » et reprise de la page en cours** — le bandeau « Mise à jour prête » propose désormais « Installer maintenant » : l'application se ferme, installe la mise à jour puis se relance seule (une confirmation s'affiche si un agent est connecté ; la croix reste « plus tard »). La page où l'agent travaillait est mémorisée et retrouvée à la reconnexion (même agent, même rôle, même site/centre, dans les 30 minutes). Les saisies de formulaire non enregistrées ne sont pas conservées.

- **Gestion des agents : tableau lisible sur les écrans 1366×768** — le tableau tient désormais dans la largeur d'un petit écran : colonnes Centre et Site regroupées, badges de rôle plus grands (libellés courts, libellé complet au survol), textes longs tronqués avec leur contenu complet au survol, lignes et cartes de statistiques plus compactes. Le rôle « Opérateur Inventaire » est maintenant proposé à la création et à la modification d'un agent.

- **Gestion des agents : l'email et le téléphone d'un agent sont enregistrés** — à la création et à la modification d'un agent, le contact (facultatif) est désormais validé, enregistré et envoyé au cloud ; il n'était auparavant pas pris en compte. Un simple changement de statut (désactivation, réactivation) n'envoie jamais un contact périmé. Les coordonnées n'apparaissent pas dans le journal d'audit.

- **Gestion des agents : champs Email et Téléphone dans le formulaire, et colonne « Dernière connexion » fiable** — le formulaire de création/modification propose maintenant l'email et le téléphone (facultatifs, vérifiés à la saisie) et reste utilisable sur un petit écran (en-tête et boutons toujours visibles). La colonne « Dernière co. » affiche la dernière connexion connue du cloud, ou à défaut celle de ce poste (marquée « local »), « Non suivi » pour les administrateurs et « Jamais » si aucune connexion.
