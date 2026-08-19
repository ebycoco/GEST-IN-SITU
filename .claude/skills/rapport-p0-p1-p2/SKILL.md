---
name: rapport-p0-p1-p2
description: Format de rapport structuré P0/P1/P2 (Bloquant/Important/Optimisation) partagé par agent-9-senior-auditor (audit statique du code) et agent-13-qa-terrain-tester (test vivant de l'application) de GEST-IN-SITU — garantit un format cohérent entre les deux, malgré leurs méthodes différentes. À charger avant de produire un rapport d'audit ou de test.
---

# Format de rapport P0/P1/P2 — GEST-IN-SITU

Deux agents produisent ce type de rapport avec la même hiérarchie de
sévérité mais un gabarit d'anomalie légèrement différent selon leur méthode
(lecture de code vs manipulation réelle de l'application). Ce skill
documente les deux, pour rester cohérent avec la source qu'on utilise.

## Hiérarchie de sévérité (commune aux deux agents)

1. **P0 — Bloquant / Critique** : risque de régression, perte/incohérence
   de données, blocage terrain.
2. **P1 — Important** : anomalie d'affichage, information incomplète,
   comportement inattendu, incohérence UI/BDD, manque ergonomique.
3. **P2 — Optimisation** : gain de performance léger, nettoyage mineur,
   détail cosmétique.

## Gabarit d'anomalie — audit statique (`agent-9-senior-auditor`)

Pour chaque anomalie détectée par lecture de code :
- **`[L'ANOMALIE]`** : description technique et précise du dysfonctionnement
  ou du risque.
- **`[L'IMPACT EN PRODUCTION]`** : conséquence directe pour les agents sur
  le terrain ou pour la cohérence des données.
- **`[LA SOLUTION ÉTANCHE PROPOSÉE]`** : recommandation de correctif
  ultra-ciblée, minimale et sans risque de régression.

## Gabarit d'anomalie — test vivant (`agent-13-qa-terrain-tester`)

Pour chaque anomalie détectée en manipulant réellement l'application :
- **`[LE SCÉNARIO TESTÉ]`** → **`[LE RÉSULTAT OBSERVÉ]`** →
  **`[LE COMPORTEMENT ATTENDU]`** → **`[IMPACT TERRAIN]`**.

Confirmer aussi explicitement ce qui fonctionne correctement (pas
seulement les problèmes) — un scénario qui passe est une information utile,
pas un non-événement.

## Livrable final (les deux agents)

Rapport structuré, dans l'ordre :
1. **Résumé** (spécifique à `agent-13` : rôles testés, scénarios couverts,
   durée, données de test créées/nettoyées).
2. **P0 — Bloquant / Critique**
3. **P1 — Important**
4. **P2 — Optimisation**

Ni l'un ni l'autre ne corrige le code lui-même : toute anomalie détectée
est destinée à `agent-3-coder` (ou au sous-agent spécialisé pertinent) via
l'orchestrateur — cf. `CLAUDE.md` §12 pour l'exigence de ne rapporter que ce
qui a été réellement vérifié (fichier:ligne pour un audit statique, état
SQLite observé pour un test vivant), jamais une supposition présentée comme
un fait.
