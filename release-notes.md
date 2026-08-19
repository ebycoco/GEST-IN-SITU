# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.16.0, 17 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

### 🛠️ Corrections & Fiabilité

- **Table `t_user_presence` absente sur l'environnement Supabase dev/staging** : créée à la main en production le 17/08/2026 (module "Présence des Agents") sans geste équivalent côté dev, faute de mécanisme de migration tracé — un test vivant multi-rôles/multi-sites du module échouait silencieusement sur cet environnement (écritures de présence rejetées). Table créée sur dev ; cloisonnement site du module (commit `88d9070`) revalidé en conditions réelles, aucun impact constaté en production (table déjà saine, données réelles en place).
- **Mise en place d'un dossier `supabase/migrations/` versionné**, cause directe de l'écart ci-dessus (`supabase_schema.sql` servait jusqu'ici de document de référence statique, jamais rejoué sur aucun projet). Schéma actuel découpé en migrations baseline versionnées ; toute évolution future du schéma devra désormais passer par un nouveau fichier de migration (dev puis prod) avant d'être reportée dans `supabase_schema.sql`.
- **Filtre de site de la page "Présence des Agents" non synchronisé avec le sélecteur "CONTEXTE OPÉRATIONNEL" du Sidebar (SUPER ADMIN)** : les deux étaient indépendants, pouvant induire en erreur un admin habitué au sélecteur du Sidebar sur les autres pages. Le filtre de la page s'initialise désormais sur le site actif du Sidebar, sans écraser un choix local fait ensuite sur la page elle-même. `data-testid` ajouté sur le bouton de déconnexion au passage (fiabilise les tests automatisés, qui butaient sur une collision de texte avec une colonne du tableau).
