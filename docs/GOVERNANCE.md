# GEST-IN-SITU — Gouvernance & Mémoire de projet

**Complément à `CLAUDE.md` (règles transverses).** Ce fichier ne redéfinit rien de ce qui existe déjà dans `CLAUDE.md` §1-12 — il ajoute la classification de risque, la mémoire de projet et le cycle d'audit qui n'y figuraient pas.

---

## 1. Classification du projet : MODE HEAVY

GEST-IN-SITU est classé **HEAVY** au sens de la matrice de risque :

| Critère | Statut réel |
|---|---|
| Utilisateurs | Parc terrain en exploitation active (> 100 potentiel, postes multiples) |
| Données | PII — cartes CMU, identité, rattachement site/centre |
| Réversibilité | Difficile — données de production, synchro Supabase |
| Dépendances | Stack Electron/React/Supabase/SQLite complète |
| Durée de vie | Application en production active, pas un prototype |

**Conséquence pratique** : toute règle déjà présente dans `CLAUDE.md` (STOP & WARN §4, interdiction release auto §1, validation `tsc` obligatoire §5, fiabilité factuelle §12) s'applique **sans exception**, y compris pour les tâches qui semblent mineures. En mode HEAVY, il n'y a pas de raccourci "petite tâche".

---

## 2. Mémoire de projet — `PROJECT_STATE.md` et `TASKS.md`

Ces deux fichiers n'existaient pas dans le dispositif actuel (qui repose sur `release-notes.md` pour le contenu des releases). Ils servent un rôle différent et complémentaire : **la mémoire de session**, pas le contenu de version.

### `PROJECT_STATE.md` — état courant (30 lignes max)

Doit répondre à 5 questions, rien de plus. Ce n'est **jamais** un journal de conversation, et ce n'est **pas** un doublon de `release-notes.md` (qui reste la seule source de vérité du contenu de release, cf. `CLAUDE.md` §8).

Template livré séparément : `PROJECT_STATE.template.md`.

### `TASKS.md` — checklist opérationnelle + suivi des audits

Contient :
- Le backlog courant (MVP / features en cours).
- Les **découvertes hors scope** (mécanisme déjà en vigueur via STOP & WARN §4 — ce fichier est l'endroit où on les consigne au lieu de les traiter à la volée).
- Les actions issues du dernier audit `agent-9-senior-auditor` (voir §3 ci-dessous), classées P1/P2/P3.

Template livré séparément : `TASKS.template.md`.

**Mise à jour** : après chaque tâche significative, et obligatoirement après chaque invocation de `agent-9-senior-auditor` ou de tout autre subagent produisant un rapport (§6 de `CLAUDE.md`).

---

## 3. Cycle d'audit — `agent-9-senior-auditor`

`agent-9-senior-auditor` existe déjà dans la table de routage (`CLAUDE.md` §6) et produit un rapport P0/P1/P2. Ce qui manquait : une **fréquence obligatoire** et un **format d'intégration** dans `TASKS.md`. Le reste de son fonctionnement interne (méthodologie d'audit) reste dans sa propre définition d'agent — ce document ne le redéfinit pas.

### Fréquence (mode HEAVY)

```
Tous les 1-3 mois (cadence à ajuster selon rythme réel des sprints)
Obligatoire avant :
  - toute release (déclenchement npm run build:win, cf. CLAUDE.md §8)
  - toute migration de schéma (schema.ts, SCHEMA_VERSION)
  - après changement touchant §3 de CLAUDE.md (cloisonnement site/centre) ou l'auth
```

**Déclenchement** : suit le même protocole que §7/§9 de `CLAUDE.md` (proposition explicite courte, attente de confirmation) — pas d'audit lancé automatiquement sans validation.

### Intégration du rapport dans `TASKS.md`

Après un audit, ajouter en tête de `TASKS.md` :

```markdown
## 🔴 AUDIT — agent-9-senior-auditor — [date]
**Rapport complet** : [lien ou résumé du rapport de l'agent]
**Prochain audit** : [date, +1 à 3 mois]

### P0/P1 — CRITIQUE (bloquant, avant toute nouvelle feature)
- [ ] [P1-XXX] Description | Fichier concerné | Effort estimé

### P2 — PRIORITAIRE (sprint suivant)
- [ ] [P2-XXX] Description

### P3 — BACKLOG
- [ ] [P3-XXX] Description
```

### Règle de blocage

> Une action **P0/P1** issue d'un audit `agent-9-senior-auditor` doit être traitée avant toute nouvelle fonctionnalité majeure, **sauf dérogation explicite de l'utilisateur**, documentée dans `PROJECT_STATE.md` avec : raison métier, mitigation temporaire, date limite ferme.

Cette règle ne change rien à `CLAUDE.md` §7 (délégation) : l'audit reste proposé, jamais lancé d'initiative.

### Autorisation permanente — intégration automatique post-rapport

**Même principe que `CLAUDE.md` §5** (autorisation durable pour la séquence commit → release-notes.md → push) : l'invocation d'un agent couvert par cette clause **vaut déjà autorisation** pour la suite ci-dessous. Aucune confirmation supplémentaire n'est nécessaire une fois l'agent lancé.

**Critère d'application** — cette autorisation s'applique à tout agent dont le rapport final contient des **items non résolus dans la session** (findings, issues, recommandations qui restent à traiter après coup), pas aux agents dont le travail EST déjà le résultat final (correctif appliqué, fichier produit, étape d'un pipeline déjà orchestré ailleurs).

Agents couverts actuellement :
- `agent-9-senior-auditor` (audit qualité/sécurité)
- `agent-13-qa-terrain-tester` (bugs remontés non corrigés dans la foulée)
- `agent-5-qa-optimisation` (fuites mémoire détectées non corrigées dans la foulée)
- `agent-10-refactoring-speed-booster` (points de perf identifiés non traités dans la foulée)
- `agent-14-debugger` — **uniquement en cas de diagnostic sans résolution** (cf. rapport d'échec debug ×3, `CLAUDE.md` §12) ; si le bug est résolu dans la session, rien à tracker.

Non couverts (traitement déjà géré ailleurs, ne pas dupliquer) :
- `agent-3-coder`, `agent-4-db-sync`, `agent-6-qa-syntax`, `agent-1-architect-pm`, `agent-2-designer`, `agent-8-icon-asset-master` — production/correctif direct, suivi via `git diff` et restitution normale (§10 de `CLAUDE.md`).
- `agent-7-release-master`, `agent-11-release-manager`, `agent-12-deploy-validator` — déjà orchestrés par le pipeline `CLAUDE.md` §8.

**Nouvel agent non listé** : appliquer le critère ci-dessus (findings à suivre vs. résultat déjà final) plutôt que d'attendre une mise à jour de cette liste.

Dès qu'un agent couvert rend son rapport, la session principale enchaîne directement, sans attendre de validation :

1. **Mise à jour de `TASKS.md`** : insertion du bloc `## 🔴 [TYPE] — [nom de l'agent] — [date]` en tête de fichier (`[TYPE]` = AUDIT, QA TERRAIN, OPTIMISATION, DIAGNOSTIC selon l'agent), au format P0/P1 (ou équivalent), P2, P3, avec la date du prochain audit calculée selon la fréquence en vigueur (§3.1) si applicable à cet agent.
2. **Mise à jour de `PROJECT_STATE.md`** : rafraîchissement de la section **SANTÉ DU PROJET** (date du dernier rapport par agent, nombre d'items ouverts, prochaine échéance si récurrente).
3. Si le rapport contient un ou plusieurs items **P0/P1** (ou équivalent bloquant), la ligne **Bloquant** de `PROJECT_STATE.md` est mise à jour pour le signaler explicitement (cf. Règle de blocage ci-dessus).

**Ce que cette autorisation ne couvre pas** (inchangé, comme pour `CLAUDE.md` §5-§6) :
- Le traitement effectif des items reste soumis au protocole STOP & WARN (`CLAUDE.md` §4) et à la proposition de délégation (`CLAUDE.md` §7) — seule l'écriture des fichiers de suivi est automatisée, pas la correction du code.
- Aucun commit n'est déclenché par cette séquence — la mise à jour de `TASKS.md`/`PROJECT_STATE.md` suit le protocole Git normal (`CLAUDE.md` §5 : commit uniquement si contenu à committer, `git diff` vérifié avant).
- Une dérogation P1 (accordée par l'utilisateur) reste un acte explicite distinct — elle n'est jamais déduite automatiquement d'un rapport.

---

## 4. Décisions structurantes — `docs/decisions/`

Pour les décisions du type de celle documentée en dur dans `CLAUDE.md` §3 (bug `getSecureCurrentUser()` sur 8 handlers), créer un ADR plutôt que d'allonger indéfiniment `CLAUDE.md` :

```
docs/decisions/ADR-001-role-actif-vs-role-primaire.md
```

Structure :
```markdown
# ADR-XXX — Titre

## Contexte
## Décision
## Alternatives envisagées
## Raisons
## Conséquences
## Handlers/fichiers concernés
```

`CLAUDE.md` garde la règle opérationnelle courte (§3 actuel) ; l'ADR garde l'historique et le raisonnement complet. Ne pas dupliquer — `CLAUDE.md` §3 peut renvoyer vers l'ADR d'un lien court si besoin.

---

## 5. Ce qui NE change PAS

Ce document n'ajoute, ne modifie, ni ne remplace :
- La table de routage des agents (`CLAUDE.md` §6).
- Le cycle de release différé (`CLAUDE.md` §8).
- Les réflexes de vigilance post-implémentation (`CLAUDE.md` §9).
- Le résumé de validation avant action (`CLAUDE.md` §10).
- Context7 (`CLAUDE.md` §11) et fiabilité factuelle (`CLAUDE.md` §12).

Ces règles restent la référence unique et ne sont pas répétées ici.
