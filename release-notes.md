# GEST-IN-SITU — Release v2.23.1 (2026-10-12)

### 🛠️ Corrections & Fiabilité

- **Synchronisation des comptes : une désactivation qui vient d'être envoyée n'est plus annulée par un téléchargement concurrent** — si un téléchargement des comptes démarrait juste avant l'envoi d'une modification (désactivation, changement de rôle...), il pouvait réécrire pendant quelques secondes l'ancienne valeur du cloud et laisser un agent désactivé se connecter. Le téléchargement ignore désormais une ligne locale synchronisée après le début de sa lecture ; elle est réalignée au cycle suivant.

- **Gestion des agents : plus de compte invisible bloqué quand le cloud refuse la suppression d'un agent** — si le cloud refuse de supprimer définitivement un agent parce qu'il a une activité enregistrée côté serveur, le compte est désormais désactivé (localement et dans le cloud) au lieu de rester bloqué en suppression en attente et de se rejouer indéfiniment. L'événement est tracé dans le journal d'audit.

- **Gestion des agents : la suppression définitive d'un agent qui a une activité le désactive à la place** — un agent ayant créé ou traité des cartes (saisie, distribution, signalement d'absence, doublon, apurement) ou réalisé des actions enregistrées ne peut plus être supprimé définitivement : il est désactivé, et un message l'explique. Cela évite que le cloud refuse la suppression et laisse un compte invisible bloqué. Un agent sans aucune activité est toujours supprimé comme avant.
