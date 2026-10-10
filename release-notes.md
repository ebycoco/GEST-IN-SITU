# GEST-IN-SITU — Prochaine version (non publiée)

### 🚀 Nouveautés & Ergonomie

- **Portail Opérateur logistique : contact renseignable en même temps que le rangement** — les écrans « Inventaire logistique » (recherche d'une carte) et « Sans rangement » (liste en masse) proposent désormais un champ « Contact (facultatif) », au même format que la recherche par téléphone : préfixe `+225` et chiffres groupés par deux (`+225 07 08 09 00 10`), collage accepté avec ou sans espaces et avec ou sans `+225`. Il est prérempli avec le contact de la fiche, n'est jamais obligatoire, et un champ vide conserve le contact existant. Un contact modifié doit comporter exactement 10 chiffres (sinon un message clair s'affiche et rien n'est enregistré, rangement compris) ; les clés de détection de doublons sont recalculées dans la même transaction. Le tableau « Sans rangement » est resserré pour limiter le défilement horizontal sur petit écran.

- **Inventaire logistique : champ « Nouveau rangement » vide pour une carte « NON CLASSE »** — le champ n'est plus prérempli avec `NON CLASSE` (l'opérateur devait l'effacer avant de saisir le bon rangement) ; une carte avec un vrai rangement le conserve. Dans la liste des résultats, une carte « NON CLASSE » affiche désormais le badge « Sans rangement », comme une carte sans rangement.

### 🛠️ Corrections & Fiabilité

- **Rangement + contact : un numéro de plus de 10 chiffres n'est plus tronqué en silence** — côté serveur, il est refusé au lieu d'enregistrer un numéro faux (ex. `07080900101` devenait `7080900101`). Côté écran, un collage de plus de 10 chiffres n'est plus raccourci : le champ reste inchangé et un message demande de vérifier les chiffres. Un contact déjà enregistré avec plus de 10 chiffres s'affiche tel quel, avec une bordure d'alerte, et ne bloque pas l'enregistrement du rangement tant qu'il n'est pas modifié. Les messages d'erreur de ces deux écrans n'affichent plus le préfixe technique d'Electron.
