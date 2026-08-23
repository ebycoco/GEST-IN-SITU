# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.17.0, 23 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

### 🚀 Nouveautés & Ergonomie

- **Onglets déplacés dans la sidebar pour 4 rôles** (`OPERATEUR_QUALITE`, `ADMIN_CENTRE`, `OPERATEUR_APUREMENT`, `OPERATEUR_VERIFICATION`) : la barre d'onglets horizontale de leur portail débordait sur les résolutions terrain et obligeait à faire défiler vers la droite — tous les onglets sont désormais des liens directs dans la sidebar verticale, groupés par section. `ADMINISTRATEUR_SITE` et `SUPER ADMIN` ne sont pas concernés : ils conservent la barre horizontale d'origine sur les pages partagées avec ces rôles. Le portail Apurement (jusqu'ici piloté par un état interne sans routage) est converti en vraies routes (`/apurement`, `/apurement/travail`, `/apurement/cartes-dechargees`) pour permettre cette intégration. Vérifié par test terrain vivant (15 scénarios) couvrant les 4 rôles migrés et la non-régression `ADMINISTRATEUR_SITE`/`SUPER ADMIN`.

### 🛠️ Corrections & Fiabilité

- **Bouton "Récupérer les cartes depuis le cloud" grisé quand l'auto-récupération est active** : ce bouton manuel (et son compteur de cartes en attente) restait actif sur les 9 vues où il apparaît (Recherche/Vérification, tableau de bord Opérateur et Administrateur de Site, portails Admin Centre, Vérification, Qualité, Apurement, Inventaire, Saisie) même quand l'utilisateur avait activé la préférence "Récupération automatique des cartes" depuis son profil — laissant croire à tort qu'une action manuelle restait nécessaire. Un nouveau hook partagé (`useAutoDownstreamPreference`) désactive désormais ce bouton et masque son compteur dans ce cas, avec reflet immédiat entre vues déjà ouvertes si la préférence est modifiée en cours de session.
