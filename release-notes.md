# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **Synchronisation des comptes : les comptes ignorés sont désormais expliqués dans le journal** — quand un téléchargement des comptes laisse de côté un compte (modification locale en attente, envoi en cours, compte supprimé, ou ligne locale plus récente que la lecture cloud), le journal indique le login et la raison exacte, ce qui facilite le diagnostic sur le terrain. Aucun mot de passe n’est journalisé et le volume est plafonné.

### 🚀 Nouveautés & Ergonomie

- **Gestion des agents : tableau lisible sur les écrans 1366×768** — le tableau tient désormais dans la largeur d'un petit écran : colonnes Centre et Site regroupées, badges de rôle plus grands (libellés courts, libellé complet au survol), textes longs tronqués avec leur contenu complet au survol, lignes et cartes de statistiques plus compactes. Le rôle « Opérateur Inventaire » est maintenant proposé à la création et à la modification d'un agent.

- **Gestion des agents : l'email et le téléphone d'un agent sont enregistrés** — à la création et à la modification d'un agent, le contact (facultatif) est désormais validé, enregistré et envoyé au cloud ; il n'était auparavant pas pris en compte. Un simple changement de statut (désactivation, réactivation) n'envoie jamais un contact périmé. Les coordonnées n'apparaissent pas dans le journal d'audit.

- **Gestion des agents : champs Email et Téléphone dans le formulaire, et colonne « Dernière connexion » fiable** — le formulaire de création/modification propose maintenant l'email et le téléphone (facultatifs, vérifiés à la saisie) et reste utilisable sur un petit écran (en-tête et boutons toujours visibles). La colonne « Dernière co. » affiche la dernière connexion connue du cloud, ou à défaut celle de ce poste (marquée « local »), « Non suivi » pour les administrateurs et « Jamais » si aucune connexion.
