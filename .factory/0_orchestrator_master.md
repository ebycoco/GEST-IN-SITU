# GOUVERNANCE GLOBALE DE LA FACTORY — MASTER

> [!CAUTION]
> ## RÈGLE ZÉRO : LA LOI DU PREMIER REGARD
> - **AVANT DE FAIRE QUOI QUE CE SOIT** (analyse, modification, commande, audit), tout agent activé dans un cycle a l'obligation stricte, absolue et immédiate de se rendre dans le dossier `.factory` et de lire intégralement le présent fichier `0_orchestrator_master.md`.
> - Il est formellement interdit de toucher à un fichier de l'application ou d'émettre une suggestion sans avoir chargé en mémoire vive la charte des rôles, la règle anti-build, la politique de RAM (Low-Memory) et la charte d'immunité technique.
> - Toute violation de cette règle (action menée sans lecture préalable du master enregistrée dans les logs) entraînera le rejet immédiat du cycle par le DG.

---

## 1. RÈGLE DE SÉCURITÉ MATÉRIELLE (LOW-MEMORY 8 Go RAM)
- **INTERDICTION ABSOLUE** d'exécuter `npm run build` de manière automatique ou arbitraire.
- Utilisez uniquement la commande `npx tsc --noEmit` lors des phases de validation technique et d'audit syntaxique.

---

## 2. ALIGNEMENT STRICT DU FLUX LINÉAIRE (AGENT 0 À 7)
Le cycle de développement s'effectue selon un flux séquentiel, autonome et linéaire géré par l'**Agent 0 (Orchestrator Master)** :
1. **Agent 0 (Orchestrator Master)** : Reçoit la mission, aiguille le flux et initialise le cycle.
2. **Agent 1 (Architecte / PM)** : Définit l'architecture et les spécifications techniques.
3. **Agent 2 (Designer)** : Rédige/audite la structure UI/UX Premium (CSS Vanilla).
4. **Agent 3 (Coder)** : Code les fonctionnalités (TypeScript/JavaScript/Node.js).
5. **Agent 4 (DB Sync)** : Valide les requêtes et la synchronisation avec SQLite/Supabase.
6. **Agent 5 (QA Optimisation)** : Traque les fuites de mémoire (IPC listeners) et valide la performance.
7. **Agent 6 (QA Syntax)** : **OBLIGATION** d'exécuter `npx tsc --noEmit` pour valider l'absence d'erreur TypeScript.
8. **Agent 7 (Release Master)** : Clôture le cycle de release et signe la livraison.

Si un Agent n'est pas concerné par une tâche, il passe son tour et transmet la main au suivant de manière autonome.

---

## 3. VERROU DE CLÔTURE
Aucun cycle ne peut être validé sans le passage final de l'**Agent 6** (validation syntaxique réussie via `npx tsc --noEmit`) et la signature finale de l'**Agent 7**.
