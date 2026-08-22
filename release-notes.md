# GEST-IN-SITU — Prochaine version (non publiée)

> **Statut :** brouillon cumulatif, alimenté à chaque commit depuis la dernière release (v2.16.1, 19 août 2026).
> Sera figé en `# GEST-IN-SITU — Release vX.Y.Z` par agent-11-release-manager au prochain `npm run build:win` (voir `CLAUDE.md` §8).

### 🚨 Sécurité

- **Déclaration/annulation de doublon (`cartes:declarerDoublon`/`cartes:annulerDoublon`) invisible dans le Journal d'Audit Système depuis un autre poste** : `CRUD_SYNC_WHITELIST` (`audit.ts`) ne listait pas les actions `CARTE_DOUBLON_DECLAREE`/`CARTE_DOUBLON_ANNULEE`, alors que le code affirmait déjà les rendre visibles cross-poste — sans cette entrée, `logAudit()` écrivait uniquement dans `t_audit_log` (local au poste), jamais dans `t_logs` (synchronisé). La carte elle-même restait correctement synchronisée ; seul le trail d'audit manquait. Détecté par `agent-9-senior-auditor`. Corrigé.
- **Canal IPC `logs:add` sans dérivation de session** : `userId`/`login` étaient acceptés bruts depuis le renderer au lieu d'être dérivés de `getSecureCurrentUser()`, contrairement aux autres handlers d'écriture d'audit — surface exposée mais sans appelant renderer câblé à ce jour. Restriction a minima appliquée, même pattern que `users:getProfile`. Détecté par `agent-9-senior-auditor`. Corrigé.

### 🛠️ Corrections & Fiabilité

- **Mojibake (corruption d'encodage UTF-8) dans des messages d'erreur affichés aux agents terrain** (`handlers.ts`, ex. "Accès refusé…" affiché "AccÃ¨s refusÃ©…") : ~230 occurrences corrigées (messages `throw new Error` remontés en toast côté renderer, logs internes, commentaires), aucune logique touchée. Détecté par `agent-9-senior-auditor`.
