---
name: low-memory-patterns
description: Patterns de code concrets pour respecter la politique Low-Memory de GEST-IN-SITU (parc terrain 8 Go de RAM, CLAUDE.md §2) — chunking par lots sur les traitements volumineux, déport asynchrone des opérations SQLite lourdes, et nettoyage des listeners IPC dans useEffect avec exemples réels du dépôt. À charger avant tout traitement massif (import, sync, indexation FTS5) ou tout abonnement à un événement IPC côté renderer.
---

# Patterns Low-Memory — GEST-IN-SITU

Complément pratique à `CLAUDE.md` §2 : la politique elle-même (pas de
boucle synchrone bloquante, chunks ≤ 500, déport asynchrone, nettoyage
proactif) est déjà définie là-bas. Ce skill documente **comment** l'appliquer
concrètement, avec des exemples réels déjà en production dans ce dépôt —
à réutiliser comme référence plutôt qu'à réinventer un pattern ad hoc.

## 1. Chunking par lots sur un traitement volumineux

Exemple réel (`src/main/sync/upstream.ts`, propagation vers Supabase) :

```ts
const CHUNK_SIZE = 50;
for (let i = 0; i < groups.upserts.length; i += CHUNK_SIZE) {
  const chunk = groups.upserts.slice(i, i + CHUNK_SIZE);
  const success = await processUpsertChunk(supabase, tableName, chunk);
  if (success) successCount += chunk.length;
}
```

Le même découpage s'applique aux deletes avant les upserts (évite qu'une
suppression d'anciens rôles supprime un nouvel upsert du même lot). Un lot
de 50 est la taille déjà validée sur ce chemin précis — pas une règle
universelle, mais un ordre de grandeur raisonnable à ajuster selon la
volumétrie réelle du traitement (jamais > 500, cf. `CLAUDE.md` §2).

## 2. Déport asynchrone d'une opération SQLite lourde

Pour toute opération bloquante (VACUUM, indexation FTS5, maintenance) :
`setTimeout`/`setImmediate` ou un worker dédié (voir
`src/main/workers/upload-worker.js`, `import-worker.js`), jamais un appel
synchrone direct dans le handler IPC qui répond à l'UI — sinon le
Main Process gèle et l'interface entière se bloque (freeze constaté sur des
postes 8 Go lors d'imports non déportés).

## 3. Nettoyage des listeners IPC dans `useEffect`

Le pattern à reproduire systématiquement côté renderer, en 2 parties.

**Côté preload** (`src/preload/index.ts`) : chaque abonnement retourne sa
propre fonction de désabonnement, plutôt que d'exposer `ipcRenderer.on` nu :

```ts
onSessionExpired: (callback: (payload?: {...}) => void) => {
  const listener = (_: any, payload?: {...}) => callback(payload);
  ipcRenderer.on('auth:session-expired', listener);
  return () => ipcRenderer.removeListener('auth:session-expired', listener);
},
```

**Côté composant React** (`src/renderer/src/pages/SyncStatusDashboard.tsx`) :
capturer la fonction de désabonnement retournée, et l'appeler dans le
`return` de nettoyage du `useEffect` :

```tsx
useEffect(() => {
  let unsubscribe: (() => void) | undefined;
  if (window.api?.sync?.onStatusChanged) {
    unsubscribe = window.api.sync.onStatusChanged((newStatus) => {
      setStatus((prev) => ({ ...prev, /* ... */ }));
    });
  }
  // ... éventuel second abonnement (unsubscribeProgress) ...
  return () => {
    if (unsubscribe) unsubscribe();
    if (unsubscribeProgress) unsubscribeProgress();
  };
}, []);
```

Sans ce nettoyage, chaque montage/démontage du composant (navigation entre
pages) accumule un nouveau listener sur le même canal IPC côté Main
Process — fuite mémoire progressive, jusqu'à plusieurs callbacks empilés
sur un même événement après quelques heures d'utilisation terrain.

## 4. Nettoyage des caches et gros tableaux d'état React

Ne pas retenir en mémoire un tableau/objet volumineux (résultats de
recherche, cache d'import) au-delà de sa fenêtre d'utilité réelle — vider
explicitement l'état (`setX(null)`/`setX([])`) quand la vue qui en avait
besoin est quittée, plutôt que de compter sur le démontage du composant
seul (un store global type Zustand, ex: `useCacheStore`, survit au
démontage et retient les données tant qu'il n'est pas explicitement purgé).
