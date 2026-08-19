# GEST-IN-SITU — Règles transverses du projet

Application Electron offline-first de gestion des cartes CMU, **déployée et en exploitation active en Côte d'Ivoire** sur des postes de terrain (8 Go de RAM). Ces règles s'appliquent à toute intervention sur ce dépôt, y compris par les sous-agents définis dans `.claude/agents/`.

## 1. Interdiction formelle de compilation/release automatique
`npm run release`, `npm run make` ou toute commande de packaging **ne doivent jamais être lancés de la propre initiative d'un agent**. Ces commandes ne s'exécutent que sur instruction écrite et explicite de l'utilisateur.

## 2. Politique Low-Memory (RAM 8 Go, parc terrain)
- Aucune boucle synchrone bloquante sur des volumes de données.
- Traitements lourds (imports massifs, VACUUM, indexation FTS5) déportés en asynchrone (chunks ≤ 500, `setTimeout`/`setImmediate`, workers).
- Pas de rétention inutile de gros tableaux/objets en mémoire (état React, closures) ; nettoyage proactif des listeners IPC dans les `useEffect`.

## 3. Cloisonnement strict par site/centre
Toute requête SQL ou handler IPC touchant `t_cartes`, `t_import_anomalies`, ou toute table liée aux cartes doit préserver le filtrage par `site_id` (et `centre_id` quand pertinent). Aucune fuite ou pollution de données inter-sites n'est tolérée.

**Source du rôle/site/centre pour toute décision de cantonnement :** dans `src/main/ipc/handlers.ts` et `src/main/database/queries/*.ts`, toute décision de portée (site_id/centre_id forcé, branche spécifique à un rôle) doit dériver de `getSecureCurrentUser()` (rôle **actif** de la session serveur, correctement maintenu par `setActiveRole()` pour un compte multi-rôles) — jamais d'une re-requête SQL directe sur `t_users.role`/`site_id`/`centre_id`. Cette dernière lit le rôle "primaire" statique en base, qui peut diverger du rôle réellement utilisé pour la session en cours si le compte a plusieurs rôles. Bug confirmé et corrigé sur 8 handlers/fonctions en août 2026 (`cartes:search`, `debug:getAllAnomalies`, `hierarchy:getCentres`, `db:purge`, `db:emergency-purge`, `maintenance:clearCloudCartes`, `createUser`, `resetAgentPassword`) — ne pas réintroduire ce pattern sur un nouveau handler. Exception légitime : `verifyUserRole()` (gate d'accès générique sur l'ensemble des rôles accordés au compte, indépendant du rôle actif par construction) et `refreshSecureCurrentUser()` (mécanisme qui alimente lui-même `getSecureCurrentUser()`) lisent `t_users`/`t_user_roles` directement à dessein — ne pas les modifier sur la base de cette règle.

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
- **Autorisation permanente (cycle de commit courant) :** l'utilisateur a donné une autorisation durable — à ne plus redemander à chaque fois — pour qu'à chaque changement de code validé (`tsc` 0 erreur), la session principale (ou l'agent ayant fait le changement) enchaîne directement : commit → mise à jour de `release-notes.md` (brouillon cumulatif, voir §8) → push. Cette autorisation ne couvre que cette séquence précise ; elle ne dispense pas des protocoles STOP & WARN (§4) ni de la proposition de délégation (§7) pour le changement de code lui-même.

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
| Diagnostic d'un bug signalé par l'utilisateur (erreur rencontrée en manipulant l'appli), recherche de cause racine | `agent-14-debugger` |

Le routage lui-même (décider quel agent invoquer) reste la responsabilité de la session principale — aucun agent ne doit être invoqué pour "orchestrer" les autres.

## 7. Réflexe de proposition systématique (avant de travailler soi-même)
Avant de traiter toi-même (session principale) une demande non triviale de l'utilisateur, vérifie d'abord si elle correspond à une ligne de la table de routage (§6) :
1. Si oui, **propose explicitement la délégation** en une phrase courte avant d'agir : *"Cette tâche correspond à `agent-X`, je le lance ?"* — puis attends une confirmation courte de l'utilisateur ("oui", "vas-y", "go", ou équivalent) avant d'invoquer l'outil Agent avec ce `subagent_type`.
2. Si l'utilisateur refuse, décline, ou ne répond pas clairement en ce sens, traite la demande toi-même sans agent.
3. Ne saute cette proposition que si l'utilisateur a déjà nommé explicitement un agent dans son message, ou si la demande est triviale (question ponctuelle, lecture simple, pas de modification de code).
4. Ne jamais prétendre qu'une réponse vient d'un agent si elle a été produite directement par la session principale — être toujours transparent sur qui a réellement traité la tâche.

## 8. Cycle de release différé (`release-notes.md` brouillon → versioning au build)
Le versioning formel (SemVer, `CHANGELOG.md`, `SCHEMA_VERSION`) est **découplé** du rythme des commits : il ne se déclenche que lorsque l'utilisateur décide explicitement de lancer `npm run build:win` (ou `release`/`make`), jamais à chaque commit intermédiaire.

**Entre deux releases — `release-notes.md` sert de brouillon cumulatif non versionné :**
- Son en-tête est `# GEST-IN-SITU — Prochaine version (non publiée)`.
- Chaque commit (cycle courant, §5) y ajoute une entrée courte sous la section thématique adaptée (🚨 Sécurité, 🚀 Nouveautés & Ergonomie, 🛠️ Corrections & Fiabilité, ⚡ Performances), dans le même style que les entrées historiques de `CHANGELOG.md`.
- `package.json` et `CHANGELOG.md` ne sont **jamais** touchés à ce stade — seul `release-notes.md` évolue.

**Séquence orchestrée au déclenchement de `npm run build:win`** (dès que l'utilisateur écrit cette instruction ou un équivalent explicite, la session principale ne lance jamais la commande directement — elle suit cette séquence, chaque étape bloquant la suivante en cas d'échec) :
1. Invoquer `agent-12-deploy-validator` → rapport GO/NO-GO complet (checklist de référence, incluant le point Schéma Supabase). Si **NO-GO**, arrêter la séquence ici et remonter les blocages précis à l'utilisateur, sans passer à la suite.
2. Si **GO**, invoquer `agent-11-release-manager` : il prend le brouillon déjà accumulé dans `release-notes.md` comme **source de vérité du contenu** du cycle (pas seulement `git log` à froid) pour déterminer le bump SemVer (règles PATCH/MINOR/MAJOR déjà définies dans son fichier), aligner `SCHEMA_VERSION` si besoin, insérer la section correspondante en tête de `CHANGELOG.md`, et renommer l'en-tête de `release-notes.md` en `# GEST-IN-SITU — Release vX.Y.Z` avec la date réelle (contenu déjà rédigé conservé, légères retouches de forme autorisées).
3. La session principale commite et pousse ces fichiers de versioning (`package.json`, `schema.ts`, `CHANGELOG.md`, `release-notes.md`), même protocole que §5.
4. `npm run build:win` s'exécute réellement (construction locale uniquement, aucune publication à ce stade).
5. Si le build réussit : la session principale crée le tag Git `vX.Y.Z` (version validée à l'étape 2) et le pousse (`git push origin vX.Y.Z`).
6. Une fois la nouvelle version confirmée par l'utilisateur, `release-notes.md` est réinitialisé à un nouveau brouillon vide (`# GEST-IN-SITU — Prochaine version (non publiée)`) pour le cycle suivant.
7. La session principale présente à l'utilisateur les étapes manuelles restantes pour publier réellement : créer la Release GitHub associée au tag `vX.Y.Z` (avec le contenu de `release-notes.md`/`CHANGELOG.md` comme notes de version). **Cette action déclenche `.github/workflows/release.yml`** (reconstruction officielle + envoi de l'auto-update aux postes terrain) — elle n'est **jamais** automatisée par un agent ni par la session principale, elle reste un geste conscient et explicite de l'utilisateur, dans le même esprit que l'interdiction de build automatique (§1).

## 9. Réflexes de vigilance post-implémentation (non-régression & UX)
En complément du réflexe de délégation (§7, qui s'applique *avant* de traiter une demande), deux réflexes s'appliquent *après* une implémentation, avant de considérer une tâche de code close. Les deux suivent le même mécanisme que §7 : proposer explicitement en une phrase courte, attendre une confirmation courte ("oui"/"vas-y"/équivalent) avant d'invoquer l'agent — jamais d'audit automatique sans validation.

### 9.1 Vigilance non-régression
Si le changement effectué (par la session principale ou un agent) touche à une fonctionnalité déjà en production — pas un ajout isolé sans point de contact avec l'existant — propose explicitement : *"Ce changement touche à [fonctionnalité/fichier partagé], je lance un audit de non-régression avec `agent-9-senior-auditor` ?"* Ne saute cette proposition que si le changement est trivial, strictement isolé (nouveau fichier/nouvelle fonctionnalité sans surface partagée), ou si l'utilisateur a déjà explicitement refusé/reporté ce type de vérification dans l'échange en cours.

### 9.2 Vérification UX après ajout d'interface
Si le changement ajoute un élément d'interface visible (bouton, page, onglet, modal, nouveau champ de formulaire), propose explicitement : *"Nouvel élément d'interface ajouté, je lance une vérification UX terrain avec `agent-13-qa-terrain-tester` ?"* Ne saute cette proposition que si l'ajout est purement cosmétique sans nouvelle interaction (ex. reformulation de texte), ou si l'utilisateur a déjà explicitement refusé/reporté ce type de vérification dans l'échange en cours.

## 10. Résumé de validation avant action (systématique, toutes sessions)
Pour toute nouvelle demande substantielle de l'utilisateur (nécessitant une action, une recherche, une modification de code/config, ou une décision) : avant de commencer à agir, produire un résumé fidèle et détaillé de ce qui a été demandé, puis **attendre une validation explicite de l'utilisateur avant de faire quoi que ce soit**.
- **Exception (pour éviter une boucle) :** une confirmation courte de l'utilisateur ("oui", "vas-y", "go", "corrige ce point", ou équivalent) donnée en réponse à une proposition ou un résumé que la session vient déjà de formuler vaut validation directe — pas de nouveau résumé ni de nouvelle attente pour cette même action.
- Cette règle est **durable et s'applique dans toutes les sessions sur ce dépôt**, pas seulement dans la conversation où elle a été formulée.
- Elle se combine avec le réflexe de délégation (§7) et les réflexes de vigilance (§9) : le résumé peut/doit mentionner si la tâche correspond à un agent de la table de routage (§6), mais l'invocation de cet agent reste soumise à la même attente de validation explicite.

## 11. Documentation à jour via Context7
Le serveur MCP `context7` (déclaré dans `.mcp.json`, actif pour toute session sur ce dépôt) doit être consulté avant de répondre à toute question portant sur une librairie, un framework, un SDK, une API ou un outil externe (React, Electron, Supabase, better-sqlite3, Playwright, Vitest, etc.) — y compris quand la réponse semble déjà connue, car les connaissances d'entraînement peuvent être obsolètes face à une version récente. À privilégier sur une recherche web pour ce type de question. Cette règle s'applique à la session principale comme aux sous-agents.

## 12. Fiabilité factuelle — zéro affirmation non vérifiée
Aucun mécanisme ne garantit une élimination totale du risque d'hallucination inhérent à un LLM, mais cette règle impose des réflexes de vérification systématiques pour le réduire au minimum. S'applique à la session principale et à tous les sous-agents.
- **Pas de suppositions présentées comme des faits.** Ne jamais citer un nom de fichier, de fonction, de handler IPC, de table/colonne SQL, ou décrire un comportement de l'application sans l'avoir réellement lu (Read/Grep/Glob) ou observé (exécution d'une commande, sortie d'outil) dans la session en cours. Interdiction de deviner un identifiant « parce que ça doit s'appeler comme ça ».
- **Source citée.** Toute affirmation technique doit pouvoir être rattachée à `fichier:ligne` ou à une sortie d'outil obtenue durant la tâche — pas à la mémoire du modèle seule.
- **Pas de succès déclaré sans preuve.** Ne jamais annoncer qu'un correctif « fonctionne » ou qu'une tâche est « terminée » sans avoir fait tourner la validation correspondante (`npx tsc --noEmit`, test ciblé, lecture du fichier modifié). Cf. §5 pour l'obligation `tsc` déjà en vigueur avant clôture d'une tâche de code.
- **Librairies/API externes.** Cas particulier couvert par §11 (Context7 obligatoire) plutôt que par la mémoire d'entraînement.
- **Incertitude assumée explicitement.** Si une information ne peut pas être vérifiée avec les moyens disponibles dans la session, le dire clairement (« je n'ai pas pu vérifier X ») plutôt que de combler le vide par une supposition présentée comme acquise.
- **Rapports de sous-agent.** Un sous-agent doit distinguer dans son rapport final ce qu'il a vérifié de ce qu'il suppose ou infère, pour que la session principale ne relaie jamais une supposition comme un fait établi.
