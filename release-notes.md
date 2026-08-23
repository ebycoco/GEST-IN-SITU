# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.17.0, 23 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

### 🚀 Nouveautés & Ergonomie

- **Onglets déplacés dans la sidebar pour 4 rôles** (`OPERATEUR_QUALITE`, `ADMIN_CENTRE`, `OPERATEUR_APUREMENT`, `OPERATEUR_VERIFICATION`) : la barre d'onglets horizontale de leur portail débordait sur les résolutions terrain et obligeait à faire défiler vers la droite — tous les onglets sont désormais des liens directs dans la sidebar verticale, groupés par section. `ADMINISTRATEUR_SITE` et `SUPER ADMIN` ne sont pas concernés : ils conservent la barre horizontale d'origine sur les pages partagées avec ces rôles. Le portail Apurement (jusqu'ici piloté par un état interne sans routage) est converti en vraies routes (`/apurement`, `/apurement/travail`, `/apurement/cartes-dechargees`) pour permettre cette intégration. Vérifié par test terrain vivant (15 scénarios) couvrant les 4 rôles migrés et la non-régression `ADMINISTRATEUR_SITE`/`SUPER ADMIN`.
