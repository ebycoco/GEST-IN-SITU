# GEST-IN-SITU — Règles transverses du projet

Application Electron offline-first de gestion des cartes CMU, **déployée et en exploitation active en Côte d'Ivoire** sur des postes de terrain (8 Go de RAM). Ces règles s'appliquent à toute intervention sur ce dépôt, y compris par les sous-agents définis dans `.claude/agents/`.

## 1. Interdiction formelle de compilation/release automatique
`npm run build`, `npm run release`, `npm run make` ou toute commande de packaging **ne doivent jamais être lancés de la propre initiative d'un agent**. Ces commandes ne s'exécutent que sur instruction écrite et explicite de l'utilisateur.

## 2. Politique Low-Memory (RAM 8 Go, parc terrain)
- Aucune boucle synchrone bloquante sur des volumes de données.
- Traitements lourds (imports massifs, VACUUM, indexation FTS5) déportés en asynchrone (chunks ≤ 500, `setTimeout`/`setImmediate`, workers).
- Pas de rétention inutile de gros tableaux/objets en mémoire (état React, closures) ; nettoyage proactif des listeners IPC dans les `useEffect`.

## 3. Cloisonnement strict par site/centre
Toute requête SQL ou handler IPC touchant `t_cartes`, `t_import_anomalies`, ou toute table liée aux cartes doit préserver le filtrage par `site_id` (et `centre_id` quand pertinent). Aucune fuite ou pollution de données inter-sites n'est tolérée.

## 4. Confinement des modifications (STOP & WARN)
Toute intervention (code, requête SQL, style, asset, config) doit rester strictement dans le périmètre demandé. Si une tâche exige de toucher un composant partagé, un utilitaire global, un schéma BDD ou un handler IPC commun :
1. Ne pas appliquer le changement.
2. Signaler précisément le fichier concerné et le module impacté.
3. Attendre l'accord explicite de l'utilisateur avant d'agir.

Rappel structurel : un sous-agent ne peut ni invoquer un autre sous-agent, ni attendre une réponse utilisateur en cours de tâche. En cas de blocage STOP & WARN, il doit **terminer sa tâche immédiatement et consigner l'alerte dans son rapport final**, à charge pour la session principale (l'orchestrateur) d'obtenir la validation de l'utilisateur avant de relancer l'agent concerné.

## 5. Protocole Git
- Ne créer de commit que si l'utilisateur le demande explicitement.
- Toujours vérifier `git diff`/`git status` avant un commit pour confirmer que seules les lignes nécessaires ont été modifiées.
- Validation statique obligatoire avant de clore une tâche de code : `npx tsc --noEmit` (0 erreur tolérée).

## 6. Table de routage (rôle → agent)
Quand une demande touche un des domaines suivants, invoquer l'agent correspondant via l'outil Agent (`subagent_type` = nom du fichier sans `.md`) :

| Domaine de la demande | Agent |
|---|---|
| Plan d'impact avant une évolution structurelle | `agent-1-architect-pm` |
| UI / CSS / ergonomie / modaux | `agent-2-designer` |
| Implémentation / correctif de code, requêtes SQL, handlers IPC | `agent-3-coder` |
| Schéma SQLite/Supabase, moteur de synchro, migrations | `agent-4-db-sync` |
| Fuite mémoire, listeners IPC non nettoyés | `agent-5-qa-optimisation` |
| Typage TypeScript strict, validation `tsc` | `agent-6-qa-syntax` |
| Orchestration d'une release (sur demande explicite) | `agent-7-release-master` |
| Icônes / splashscreen / assets de build | `agent-8-icon-asset-master` |
| Audit global qualité/sécurité (rapport P0/P1/P2) | `agent-9-senior-auditor` |
| Optimisation performance/RAM ciblée | `agent-10-refactoring-speed-booster` |
| Versioning SemVer, CHANGELOG, `SCHEMA_VERSION` | `agent-11-release-manager` |
| Checklist GO/NO-GO avant publication | `agent-12-deploy-validator` |
| Test fonctionnel vivant de l'appli (lancer, cliquer, vérifier en base) par rôle | `agent-13-qa-terrain-tester` |

Le routage lui-même (décider quel agent invoquer) reste la responsabilité de la session principale — aucun agent ne doit être invoqué pour "orchestrer" les autres.

## 7. Réflexe de proposition systématique (avant de travailler soi-même)
Avant de traiter toi-même (session principale) une demande non triviale de l'utilisateur, vérifie d'abord si elle correspond à une ligne de la table de routage (§6) :
1. Si oui, **propose explicitement la délégation** en une phrase courte avant d'agir : *"Cette tâche correspond à `agent-X`, je le lance ?"* — puis attends une confirmation courte de l'utilisateur ("oui", "vas-y", "go", ou équivalent) avant d'invoquer l'outil Agent avec ce `subagent_type`.
2. Si l'utilisateur refuse, décline, ou ne répond pas clairement en ce sens, traite la demande toi-même sans agent.
3. Ne saute cette proposition que si l'utilisateur a déjà nommé explicitement un agent dans son message, ou si la demande est triviale (question ponctuelle, lecture simple, pas de modification de code).
4. Ne jamais prétendre qu'une réponse vient d'un agent si elle a été produite directement par la session principale — être toujours transparent sur qui a réellement traité la tâche.
