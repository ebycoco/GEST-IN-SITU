# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.15.0, 17 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

## 🚀 Nouveautés & Ergonomie

- **Indicateur de synchronisation Supabase pour l'opérateur, sur "Travail du jour" (Apurement)** : même badge par carte (Synchronisé/En attente/Échec) + récapitulatif agrégé + rafraîchissement automatique déjà validé sur Vérification/Saisie, porté à l'identique sur le portail Apurement — toutes les actions d'écriture de ce portail (émargement rétroactif, déclaration de doublon) enfilent déjà systématiquement dans `t_outbox`, donc les 3 états sont tous atteignables et l'auto-refresh 30 s a le même sens que côté Vérification.
- **Récapitulatif agrégé de synchronisation sur la Vue d'ensemble Qualité** : contrairement à Vérification/Saisie/Apurement, aucune colonne fiable n'attribue une correction Qualité à un agent et une date précise, et les corrections de ce portail suivent 3 régimes de synchro différents selon l'action (automatique inconditionnel, automatique conditionnel avec abandon silencieux si la carte appartient encore à un groupe de doublons non résolu, ou 100 % manuel) — une vraie liste "mes cartes du jour" par carte n'y est donc pas fiable. À la place, un compteur agrégé site-wide ("X cartes en attente de synchro, dont Y en échec") a été ajouté sur toutes les cartes non synchronisées du site, correct quel que soit le régime de synchro de l'action d'origine, mis à jour via l'écouteur `app:data-updated` déjà utilisé par le compteur existant — aucun nouveau timer.

Validé par audit de non-régression et QA terrain via harnais Playwright isolé (badge, rafraîchissement, cloisonnement site) et `npx tsc --noEmit` : 0 erreur.

## 🛠️ Corrections & Fiabilité

- **Rôle `OPERATEUR_APUREMENT` ignoré par le bouton manuel "Récupérer les agents depuis le Cloud"** : la liste de rôles valides de `pullAgentsFromCloud` (`users.queries.ts`) avait été oubliée lors de l'introduction de ce rôle (v2.13.0) — un agent Apurement remonté via ce bouton spécifique était silencieusement filtré (`Rôle invalide ignoré`), alors que les autres chemins de synchro (cycle automatique, préchargement au démarrage) le géraient déjà correctement. Corrigé.

Validé par `npx tsc --noEmit` : 0 erreur.
