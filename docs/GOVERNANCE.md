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
