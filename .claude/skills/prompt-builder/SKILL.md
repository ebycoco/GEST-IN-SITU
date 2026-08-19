---
name: prompt-builder
description: Transforme une demande vague de l'utilisateur ("écris-moi un prompt pour X", "prépare un prompt pour l'agent Y", ou toute tâche trop floue pour être déléguée telle quelle) en un prompt détaillé et précis — contexte, fichiers/lignes exacts, contraintes CLAUDE.md pertinentes, critères de validation — et identifie l'agent de la table de routage (CLAUDE.md §6) le mieux adapté. Ne délègue jamais lui-même : s'arrête toujours au prompt fini, pour validation explicite avant invocation (CLAUDE.md §7/§10).
user-invocable: true
---

# /prompt-builder — Générateur de prompt précis pour délégation d'agent

## But

Transformer une demande vague en un prompt directement exploitable par un
agent de `.claude/agents/`, en respectant la même exigence que celle décrite
dans les instructions système de la session principale : ne jamais faire
deviner à l'agent ce qu'on veut, toujours inclure chemins de fichiers et
lignes précises, le "pourquoi" derrière la tâche, les contraintes projet
pertinentes, et des critères de complétion vérifiables.

Ce skill ne fait jamais l'implémentation lui-même, et n'invoque jamais
l'outil Agent — il ne produit que le prompt et une proposition d'agent
cible, pour validation explicite de l'utilisateur avant toute délégation
(mécanisme normal du §7 de `CLAUDE.md`).

## Étapes

1. **Comprendre la demande réelle.** Si un point bloquant reste ambigu
   (quel fichier, quel rôle, quel comportement exact attendu, quel
   périmètre), poser une question ciblée via `AskUserQuestion` plutôt que de
   deviner. Une seule passe de clarification si possible — ne pas multiplier
   les allers-retours.

2. **Explorer le code pertinent avant d'écrire le prompt.** Utiliser
   Glob/Grep/Read pour identifier précisément : fichiers concernés,
   fonctions/handlers/composants exacts, comportement actuel constaté dans
   le code (pas supposé). Un prompt qui dit "corrige le bug de recherche"
   sans fichier ni ligne n'est pas une sortie acceptable de ce skill.

3. **Identifier l'agent cible** en croisant le domaine de la demande avec la
   table de routage de `CLAUDE.md` §6 (`agent-1-architect-pm` à
   `agent-13-qa-terrain-tester`). Si la demande couvre plusieurs domaines
   distincts (ex. correctif backend + retouche UI), le signaler explicitement
   et proposer soit un prompt par agent, soit un agent unique si le
   périmètre reste cohérent pour lui seul.

4. **Rédiger le prompt final**, structuré ainsi :
   - **Contexte** — projet GEST-IN-SITU (Electron offline-first, cartes CMU,
     Côte d'Ivoire, postes terrain 8 Go RAM) ; le "pourquoi" de la tâche, pas
     seulement le "quoi".
   - **État actuel** — ce qui existe déjà : fichiers/lignes précis,
     comportement observé dans le code.
   - **Tâche demandée** — ce qui doit changer, sans ambiguïté, avec le
     périmètre exact (ce qui est inclus, ce qui ne l'est pas).
   - **Contraintes applicables** — uniquement les règles `CLAUDE.md`
     pertinentes pour cette tâche précise (ex. cloisonnement site/centre §3,
     politique low-memory §2, confinement/STOP & WARN §4) ; ne pas recopier
     tout `CLAUDE.md`.
   - **Validation attendue** — ce que l'agent doit vérifier avant de
     considérer la tâche terminée (`npx tsc --noEmit` 0 erreur, non-
     régression, test fonctionnel, etc. selon le cas).

5. **Ne jamais invoquer l'outil Agent depuis ce skill.** Présenter le prompt
   final à l'utilisateur avec l'agent proposé, dans le même format que le
   réflexe habituel de la session principale : *"Voici le prompt préparé
   pour `agent-X`, je le lance ?"* — puis attendre une confirmation
   explicite avant toute invocation, exactement comme pour une délégation
   normale.

## Sortie attendue

Un bloc de prompt prêt à transmettre tel quel à l'outil Agent une fois
validé, précédé d'une ligne indiquant l'agent proposé et, si pertinent, la
raison de ce choix.
