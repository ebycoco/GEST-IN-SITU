# GEST-IN-SITU — Prochaine version (non publiée)

### 🛠️ Corrections & Fiabilité

- **Gestion des agents : la suppression définitive d'un agent qui a une activité le désactive à la place** — un agent ayant créé ou traité des cartes (saisie, distribution, signalement d'absence, doublon, apurement) ou réalisé des actions enregistrées ne peut plus être supprimé définitivement : il est désactivé, et un message l'explique. Cela évite que le cloud refuse la suppression et laisse un compte invisible bloqué. Un agent sans aucune activité est toujours supprimé comme avant.
