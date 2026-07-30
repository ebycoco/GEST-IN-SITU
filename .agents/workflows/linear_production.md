# Séquence Linéaire de Production & Chaîne de Validation

Ce workflow fixe le protocole de production séquentiel à appliquer à chaque cycle d'intervention sur GEST-IN-SITU.

---

## 1. Protocole de Production Étape par Étape

### 📐 Étape 1 : Alignement et Plan de Phase 1 (Agent 0 & Agent 1)
- L'Agent 0 reçoit la demande du DG, l'aiguille selon sa nature et demande à l'Agent 1 (Architecte/PM) de concevoir le **PLAN D'IMPLÉMENTATION COMPLET** (fichiers impactés, modifications prévues, risques).
- La Factory s'arrête et attend le **"Feu vert"** explicite du DG (Précieux) avant toute écriture.

### 📝 Étape 2 : Spécifications & Impact Mémoriel (Agent 1)
- L'Agent 1 affine les spécifications et documente l'impact sur la mémoire technique globale du projet ([factory_memory.md](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/.agents/storage/factory_memory.md)).

### 💻 Étape 3 : Écriture du Code Expert (Agent 3)
- L'Agent 3 produit le code en respectant scrupuleusement l'immunité technique (pas de typage lâche `any`, gestion d'erreur stricte) et la norme Lightweight (RAM 8 Go).

### 🧪 Étape 4 : Scan Syntaxique et Validation (Agent 6)
- L'Agent 6 (QA Syntax) inspecte le code modifié.
- Il vérifie les accolades/parenthèses orphelines, l'absence de type `any` et valide strictement les typages TypeScript.
- Tout manquement bloque le cycle et renvoie à l'étape 3.

### 🛡️ Étape 5 : Restitution & Audit de Release (Agent 7)
- L'Agent 7 effectue les vérifications passives (structure de l'installeur `installer.iss`, `package.json`, versions).
- L'Agent 0 rédige le **Rapport de Production Complet et Participatif** final décrivant l'action de chaque agent, puis met à jour [Gemini.md](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/Gemini.md) et [factory_memory.md](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/.agents/storage/factory_memory.md).

---

## 2. Norme des 13 Agents & Restitution Obligatoire
À la clôture de CHAQUE mission, le rapport final de l'Agent 0 doit OBLIGATOIREMENT être découpé nominativement par Agent, en précisant l'action de chaque sous-agent impliqué :

* 🤖 **Agent 0 (Orchestrateur)** : Analyse du besoin, distribution des tâches et gouvernance.
* 🏗️ **Agent 1 (Architecte Système)** : Structure, modélisation des flux et architecture.
* 🎨 **Agent 2 (UX/UI Designer)** : Interfaces, visuels et expérience utilisateur.
* 💻 **Agent 3 (Développeur Full-Stack)** : Code React, TypeScript, Electron et IPC.
* 🗄️ **Agent 4 (Expert BDD & Sync)** : SQLite, transactions atomiques et Supabase.
* 🔍 **Agent 5 (Ingénieur Qualité & Anomalies)** : Détection et résolution des bugs complexes.
* ⚡ **Agent 6 (Optimiseur & Refactoring)** : Nettoyage du code et réduction de la dette technique.
* 🚀 **Agent 7 (Orchestrateur de Déploiement)** : Pipelines de livraison et préparation des builds.
* 🖼️ **Agent 8 (Asset & Graphic Manager)** : Gestion des icônes et ressources visuelles.
* 📝 **Agent 9 (Validateur Syntaxe)** : Respect des normes de nommage, linter et formatting.
* ⏱️ **Agent 10 (Ingénieur Performance)** : Optimisation des requêtes lentes et background workers.
* 📦 **Agent 11 (Release Manager)** : Versioning SemVer et Release Notes.
* 🧪 **Agent 12 (Deploy Validator / QA Final)** : Execution `npx tsc --noEmit`, non-régression et mise à jour de la mémoire.
