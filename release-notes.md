# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.14.0, 13 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🛠️ Corrections & Fiabilité

- **Bouton de synchro ("Synchroniser mes actions" / "mes saisies") restant inactif après une action métier, sur 3 portails** : après une délivrance de carte (OPERATEUR_VERIFICATION, ADMIN_CENTRE) ou une correction qualité (OPERATEUR_QUALITE), le compteur qui pilote l'état actif/inactif du bouton n'était jamais recalculé — l'agent devait quitter puis revenir sur l'écran (ou attendre jusqu'à 30 s pour ADMIN_CENTRE) avant de pouvoir synchroniser. Corrigé sur les 3 portails :
  - **OPERATEUR_VERIFICATION** (Recherche Active) : la vraie fonction de rafraîchissement du layout parent est désormais transmise à l'écran de délivrance, au lieu d'un callback factice.
  - **OPERATEUR_QUALITE** : le bouton "Actualiser" et les actions de correction (suppression/fusion de doublon, correction de champ manquant ou de format) déclenchent maintenant réellement le recalcul des compteurs de synchro.
  - **ADMIN_CENTRE** : une délivrance déclenche désormais un rafraîchissement immédiat du compteur, au lieu d'attendre le cycle automatique de 30 secondes.

Validé par un test e2e dédié (délivrance réelle en conditions applicatives, vérification du bouton actif sans remontage d'écran) et `npx tsc --noEmit` : 0 erreur.
