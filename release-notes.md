# GEST-IN-SITU — Prochaine version (non publiée)

### 🚀 Nouveautés & Ergonomie

- **Portail Opérateur logistique : contact renseignable en même temps que le rangement** — les écrans « Inventaire logistique » (recherche d'une carte) et « Sans rangement » (liste en masse) proposent désormais un champ « Contact (facultatif) », au même format que la recherche par téléphone : préfixe `+225` et chiffres groupés par deux (`+225 07 08 09 00 10`), collage accepté avec ou sans espaces et avec ou sans `+225`. Il est prérempli avec le contact de la fiche, n'est jamais obligatoire, et un champ vide conserve le contact existant. Un contact modifié doit comporter exactement 10 chiffres (sinon un message clair s'affiche et rien n'est enregistré, rangement compris) ; les clés de détection de doublons sont recalculées dans la même transaction. Le tableau « Sans rangement » est resserré pour limiter le défilement horizontal sur petit écran.

### 🛠️ Corrections & Fiabilité

- **Rangement + contact : un numéro de 11 ou 12 chiffres n'est plus tronqué en silence** — il est refusé côté serveur au lieu d'enregistrer un numéro faux (ex. `07080900101` devenait `7080900101`). Les messages d'erreur de ces deux écrans n'affichent plus le préfixe technique d'Electron.
