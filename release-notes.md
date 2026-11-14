# GEST-IN-SITU — Prochaine version (non publiée)

## 🛠️ Corrections & Fiabilité
- **Outillage (développeurs)** : `npm run lint` fonctionne enfin (ESLint 10 configuré dans `eslint.config.mjs`, règles des hooks React sur l'interface). Aucun changement pour les postes : 0 erreur, les remarques sur le code existant sont en avertissement.
- **Espace Qualité (anomalies brutes, doublons, format invalide, données manquantes)** : si l'on changeait de page ou de filtre pendant un chargement, la liste pouvait rester sur l'ancienne page. Seule la réponse la plus récente s'affiche désormais.
- **Espace Qualité, vue « Dates invalides »** : le filtre par nom et prénom n'avait aucun effet (la liste et le total restaient inchangés). Il filtre maintenant la liste et le total.
- **Maintenance System** : le rafraîchissement automatique (toutes les 10 s) ne ramène plus l'ancienne page ou l'ancien filtre des journaux après un changement.
