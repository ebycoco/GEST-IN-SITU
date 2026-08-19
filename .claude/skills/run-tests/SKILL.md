---
name: run-tests
description: Lance la suite de validation du projet GEST-IN-SITU — vérification TypeScript stricte (`npx tsc --noEmit`), tests unitaires Vitest, et tests end-to-end Playwright en option. Si l'utilisateur ne précise pas le mode ("fait le test", "lance les tests"), demande de clarifier avant de lancer quoi que ce soit. Si aucune spec existante ne couvre le scénario visé, propose `agent-13-qa-terrain-tester` (test vivant de l'application) plutôt que de forcer un run vide. Résume les résultats de façon lisible et ne corrige rien automatiquement. Utiliser quand l'utilisateur demande de lancer/vérifier les tests, valider une modification, ou avant de clore une tâche de code.
user-invocable: true
---

# /run-tests — Suite de validation GEST-IN-SITU

Arguments passés : `$ARGUMENTS`

## 0. Déterminer le mode

Si `$ARGUMENTS` précise déjà clairement un mode (ex. `e2e`, `e2e <mot-clé>`,
`rapide`), passer directement à l'exécution avec ce mode — ne pas
redemander.

Sinon (argument vide, ou demande formulée en langage naturel type "fait le
test"/"lance les tests" sans précision), poser la question via
`AskUserQuestion` avant de lancer quoi que ce soit :

- **Rapide** (recommandé par défaut) : `tsc` + Vitest, local, quelques
  secondes.
- **e2e complet** : ajoute les 61 specs Playwright, plus lent, lance
  réellement l'application.
- **e2e ciblé** : demande alors un mot-clé (nom de fichier/fonctionnalité)
  pour filtrer les specs Playwright exécutées.

## Modes

- **Rapide** : `npx tsc --noEmit` puis `npm run test` (Vitest, tests
  unitaires). Tout est local, aucun effet de bord réseau.
- **e2e complet** : enchaîne en plus `npm run test:e2e` (Playwright) après
  les deux premiers. **Avant de le lancer**, vérifier via `Glob`/`Grep` si
  des specs `e2e/specs/**/*.cloud.e2e.spec.ts` vont être exécutées — si
  oui, prévenir explicitement l'utilisateur qu'elles touchent le vrai
  projet Supabase dev/staging (`.env.e2e`), jamais la production.
- **e2e ciblé** : `npx playwright test <mot-clé>` (filtre par nom de
  fichier) au lieu du run complet — même vérification `.cloud.e2e.spec.ts`
  que ci-dessus si le mot-clé matche un tel fichier.

### Aucune spec existante pour le scénario demandé

Avant de lancer un mode e2e (complet ou ciblé), vérifier via `Glob`
(`e2e/specs/**/*<mot-clé>*.e2e.spec.ts` ou équivalent) qu'au moins un
fichier correspond réellement au scénario que l'utilisateur veut vérifier —
pas seulement qu'un mot-clé matche par coïncidence un fichier sans rapport.

Si rien ne couvre le scénario (mot-clé sans résultat, ou fonctionnalité
manifestement non testée par les specs existantes), ne pas lancer un
Playwright vide pour la forme. Proposer à la place, comme pour le réflexe de
délégation habituel (`CLAUDE.md` §7) : *"Aucune spec e2e n'existe pour
[scénario], je lance `agent-13-qa-terrain-tester` pour un test vivant de
l'application à la place ?"* — puis attendre confirmation explicite avant
d'invoquer l'agent. Ce skill ne l'invoque jamais de lui-même sans cette
confirmation.

## Étapes

1. **`npx tsc --noEmit`.** Si des erreurs remontent, **s'arrêter là** : les
   reporter clairement (fichier, ligne, message) et ne pas lancer les
   étapes suivantes — inutile de faire tourner des tests sur du code qui ne
   compile pas.
2. **`npm run test`** (Vitest). Résumer : nombre de tests passés/échoués,
   et pour chaque échec le nom du test + un extrait pertinent de l'erreur
   (pas le flot de logs brut).
3. **Si mode e2e (complet ou ciblé)** : lancer la commande Playwright
   correspondante (le script `pretest:e2e` lance déjà automatiquement
   `electron-vite build` avant — build simple, non packaging, autorisé).
   Même format de résumé qu'à l'étape 2.

## Ce que ce skill ne fait pas

- Il ne corrige aucun code lui-même, même en cas d'échec évident — il
  rapporte seulement. Une correction reste une action délibérée séparée,
  potentiellement via le réflexe de délégation habituel (`CLAUDE.md` §7).
- Il ne lance jamais `npm run build:win`/`release`/`make` — hors de son
  périmètre (interdiction `CLAUDE.md` §1).

## Sortie attendue

Un résumé court et clair : ✅/❌ par étape exécutée, et si échec, assez de
détail (fichier/ligne/message) pour agir dessus sans avoir à relancer soi-même
la commande.
