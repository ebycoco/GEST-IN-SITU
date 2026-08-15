# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.14.0, 13 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🚨 Sécurité

- **Recherche cloud d'urgence (`searchCloudEmergency`) sans contrôle de rôle ni cloisonnement centre** : ce handler, déclenché en repli quand la recherche locale ne trouve rien, n'imposait aucune vérification de rôle (contrairement aux handlers voisins) et ne recadrait pas le rôle ADMIN_CENTRE sur son propre centre — un ADMIN_CENTRE pouvait ainsi obtenir téléphone et n° CMU en clair de bénéficiaires d'un autre centre du même site. Corrigé : contrôle de rôle ajouté (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_VERIFICATION) et filtre centre appliqué pour ADMIN_CENTRE, basé sur la session serveur.
- **Modification de date de naissance (`updateDate`) sans aucune vérification** : ce handler d'écriture ne vérifiait ni la session, ni le rôle, ni le site de la fiche ciblée — une donnée d'identité sensible pouvait être modifiée sans contrôle. Corrigé : contrôle de rôle (OPERATEUR_APUREMENT, OPERATEUR_INVENTAIRE, ADMINISTRATEUR_SITE, SUPER ADMIN) et vérification que la fiche appartient au site de l'utilisateur avant toute écriture.
- **11 handlers du portail Qualité (doublons, données manquantes, dates invalides, recherche universelle) sans contrôle de rôle** : le cloisonnement par site était correct mais n'importe quel rôle authentifié pouvait, via un appel IPC direct, accéder à ces listings de cartes. Contrôle de rôle ajouté (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_QUALITE) sur les 11 handlers concernés.
- **`cartes:searchQuickLogistique` (portail Logistique) sans contrôle de rôle** : même défaut, corrigé (SUPER ADMIN, ADMINISTRATEUR_SITE, OPERATEUR_INVENTAIRE, OPERATEUR_LOGISTIQUE).

Validé par `npx tsc --noEmit` : 0 erreur.

## 🛠️ Corrections & Fiabilité

- **Bouton de synchro ("Synchroniser mes actions" / "mes saisies") restant inactif après une action métier, sur 3 portails** : après une délivrance de carte (OPERATEUR_VERIFICATION, ADMIN_CENTRE) ou une correction qualité (OPERATEUR_QUALITE), le compteur qui pilote l'état actif/inactif du bouton n'était jamais recalculé — l'agent devait quitter puis revenir sur l'écran (ou attendre jusqu'à 30 s pour ADMIN_CENTRE) avant de pouvoir synchroniser. Corrigé sur les 3 portails :
  - **OPERATEUR_VERIFICATION** (Recherche Active) : la vraie fonction de rafraîchissement du layout parent est désormais transmise à l'écran de délivrance, au lieu d'un callback factice.
  - **OPERATEUR_QUALITE** : le bouton "Actualiser" et les actions de correction (suppression/fusion de doublon, correction de champ manquant ou de format) déclenchent maintenant réellement le recalcul des compteurs de synchro.
  - **ADMIN_CENTRE** : une délivrance déclenche désormais un rafraîchissement immédiat du compteur, au lieu d'attendre le cycle automatique de 30 secondes.

Validé par un test e2e dédié (délivrance réelle en conditions applicatives, vérification du bouton actif sans remontage d'écran) et `npx tsc --noEmit` : 0 erreur.

- **Recherche de carte introuvable en apurement alors que trouvée en vérification, sur le même site** : l'écran "Travail d'apurement" (OPERATEUR_APUREMENT et onglet apurement de OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE/ADMINISTRATEUR_SITE/SUPER ADMIN) comparait noms/prénoms avec une correspondance texte stricte (sensible à l'ordre des mots et aux accents), contrairement à la recherche de vérification déjà indexée FTS5. Un prénom composé saisi partiellement ou dans un ordre différent (cas très fréquent, ~54 % des cartes) ou un accent manquant à la saisie faisait échouer la recherche à tort. La fonction de recherche apurement utilise désormais le même index FTS5, avec tri alphabétique conservé et message d'avertissement si la limite de résultats est atteinte.
- **Accès refusé sur "Identification Guidée" pour OPERATEUR_QUALITE** : ce rôle appelait la même recherche que l'apurement mais n'était pas autorisé côté handler — corrigé.

Validé par test fonctionnel vivant (rôles OPERATEUR_APUREMENT, OPERATEUR_QUALITE, OPERATEUR_VERIFICATION, contrôle négatif OPERATEUR_SAISIE) et `npx tsc --noEmit` : 0 erreur.
