# 🧠 GEMINI.md — Documentation Maître du Projet GEST-IN-SITU
> **LIRE EN PRIORITÉ ABSOLUE.** Ce fichier est la source de vérité unique pour tout modèle IA travaillant sur ce projet. Il doit être relu à chaque début de session.

---

## 📌 1. Présentation de l'Application

**Nom** : `GEST-IN-SITU` (Gestion In-Situ des Cartes CMU)
**Version courante** : `2.7.0`
**Auteur** : EBYCHOCO
**Statut** : ⚠️ **EN PRODUCTION ACTIVE en Côte d'Ivoire** — déployée sur des postes opérationnels en centre.
**Type** : Application desktop **Electron** (Windows), mono-exécutable, sans navigateur externe requis.

### Section 13 : Outbox Pattern & Sync Engine (Supabase)

L'application utilise un moteur de synchronisation "Offline-First" avec une file d'attente locale (`t_outbox`).

**Règles du Pattern Outbox (SCHEMA_VERSION 55) :**
1. Toute modification (INSERT/UPDATE/DELETE) en local est enfilée dans `t_outbox`.
2. Les opérations s'exécutent séquentiellement par ordre de création.
3. **Idempotence stricte** : `id` Outbox (UUID) = UPSERT pour éviter les doublons lors des tentatives réseau échouées.
4. **Dépendances Scopées (V55)** : Lors d'opérations complexes (ex: Fusion de doublons en hors-ligne), l'opération enfant (ex: `DELETE` de la carte source) hérite d'une dépendance `depends_on = target_sync_id`. La file `t_outbox` garantit que l'enfant ne sera jamais traité tant que le parent n'est pas `SYNCED`. En cas d'erreur définitive du parent, l'enfant est suspendu sans bloquer le reste de la file.

### Failles de Synchronisation et Correctifs (V55)
- [Corrigé] **Asymétrie Suppression/Mise à jour** : Une fusion hors-ligne provoquait une perte de données si l'UPDATE échouait mais que le DELETE passait. Fixé via le mécanisme `depends_on`.
- [Corrigé] **Erreur Fantôme `sync_id` local** : Rejet par Supabase d'un UPDATE si la création originale de la carte n'a jamais atteint le cloud. Fixé via une vérification stricte mais jamais bloquante.

---

## 🎯 2. Ce Que Fait l'Application

GEST-IN-SITU est un système de gestion du **cycle de vie complet des cartes CMU** :

1. **Import CSV** de listes de bénéficiaires (depuis des fichiers Excel/CSV fournis par les sites).
2. **Saisie manuelle** de nouvelles cartes par les opérateurs de saisie.
3. **Distribution / Retrait** physique des cartes aux bénéficiaires.
4. **Vérification** de l'identité lors du retrait (recherche par nom, numéro de sécurité sociale, etc.).
5. **Inventaire physique** des cartes en stock (rangements, emplacements, lots).
6. **Qualité des données** : détection et correction des doublons, données manquantes, formats invalides.
7. **Synchronisation cloud Supabase** (upstream et downstream) avec gestion de file d'attente (Outbox).
8. **Export** des données en CSV, Excel et PDF.
9. **Administration** : gestion des sites, centres, utilisateurs et rôles.
10. **Audit et Logs** : traçabilité complète de toutes les actions opérateurs.

---

## 🗂️ 3. Structure des Fichiers (Auditée le 2026-07-27)

```
GEST_IN-SITU_CARTE_ABOBO_V2/
├── .agents/
│   ├── config/factory_sync.json
│   ├── skills/
│   ├── storage/
│   │   ├── factory_memory.md
│   │   └── GEMINI.md (← CE FICHIER)
│   └── workflows/memory.md
│
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── auto-updater.ts
│   │   ├── updater.ts              [NON DOCUMENTÉ AVANT]
│   │   ├── backup.ts               [NON DOCUMENTÉ AVANT]
│   │   ├── auth/local-auth.ts
│   │   ├── utils/audit.ts          [NON DOCUMENTÉ AVANT]
│   │   ├── database/
│   │   │   ├── connection.ts
│   │   │   ├── schema.ts           (Migrations v1→v55, SCHEMA_VERSION = 55)
│   │   │   └── queries/
│   │   │       ├── cartes.queries.ts      (~53 Ko)
│   │   │       ├── users.queries.ts       (~30 Ko)
│   │   │       ├── hierarchy.queries.ts   (~27 Ko)
│   │   │       ├── stats.queries.ts       (~17 Ko)
│   │   │       ├── absence.queries.ts     (~14 Ko)
│   │   │       ├── maintenance.queries.ts (~11 Ko)
│   │   │       ├── sync.queries.ts        (~9 Ko)
│   │   │       ├── config.queries.ts
│   │   │       ├── logs.queries.ts
│   │   │       ├── audit.queries.ts
│   │   │       ├── import.queries.ts
│   │   │       └── index.ts
│   │   ├── ipc/handlers.ts         (⚠️ FICHIER CENTRAL ~194 Ko)
│   │   ├── sync/
│   │   │   ├── sync-engine.ts      (~29 Ko — Orchestrateur)
│   │   │   ├── upstream.ts         (~13 Ko)
│   │   │   ├── downstream.ts       (~46 Ko)
│   │   │   ├── outbox.service.ts   (~21 Ko)
│   │   │   ├── bulk-uploader.ts    (~6.5 Ko)
│   │   │   ├── supabase-client.ts  (~3.8 Ko)
│   │   │   └── network-monitor.ts  (~8.7 Ko)
│   │   └── workers/
│   │       ├── import-worker.js    (~43 Ko — Thread Import CSV)
│   │       ├── stats-worker.js     (~17 Ko — Thread Stats Dashboard)
│   │       ├── download-worker.js  [NON DOCUMENTÉ AVANT]
│   │       └── upload-worker.js    [NON DOCUMENTÉ AVANT]
│   │
│   ├── preload/
│   │   ├── index.ts                (~34 Ko — contextBridge)
│   │   └── global.d.ts             (⚠️ TYPES TS — SOURCE DE VÉRITÉ)
│   │
│   ├── renderer/src/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── stores/
│   │   │   ├── authStore.ts        (initialDataLoading = false par défaut)
│   │   │   ├── cacheStore.ts
│   │   │   ├── qualityUIStore.ts   (isFetchingQuery, openCorrection, etc.)
│   │   │   └── syncDownstreamStore.ts
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── MainLayout.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TopBar.tsx
│   │   │   │   └── CentreContextSwitcher.tsx  [NON DOCUMENTÉ AVANT]
│   │   │   ├── Quality/
│   │   │   │   ├── ExpandedAnomalyDetails.tsx (~15 Ko — PARTAGÉ)
│   │   │   │   ├── AdvancedSearchBar.tsx
│   │   │   │   ├── CorrectionSidePanel.tsx
│   │   │   │   └── IdentificationGuidee.tsx
│   │   │   ├── GlobalConfirmModal.tsx
│   │   │   ├── DateInput.tsx
│   │   │   ├── PaginationInput.tsx
│   │   │   ├── OnlineBadge.tsx    [NON DOCUMENTÉ AVANT]
│   │   │   ├── RoleRedirect.tsx   [NON DOCUMENTÉ AVANT]
│   │   │   ├── SyncWidget.tsx
│   │   │   └── confirmService.ts
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ProfilePage.tsx        [NON DOCUMENTÉ AVANT]
│   │   │   ├── RoleSelectorPage.tsx   [NON DOCUMENTÉ AVANT]
│   │   │   ├── SearchPage.tsx         [NON DOCUMENTÉ AVANT]
│   │   │   ├── TableCartesPage.tsx    [NON DOCUMENTÉ AVANT]
│   │   │   ├── SaisiePage.tsx         [Composant partagé]
│   │   │   ├── AdminCentreDashboardPage.tsx
│   │   │   ├── AdminQueuePage.tsx
│   │   │   ├── CartesPage.tsx
│   │   │   ├── ImportPage.tsx
│   │   │   ├── ExportPage.tsx
│   │   │   ├── AgentsPage.tsx
│   │   │   ├── SitesPage.tsx
│   │   │   ├── LogsPage.tsx
│   │   │   ├── MaintenancePage.tsx
│   │   │   ├── SyncStatusDashboard.tsx
│   │   │   ├── RetraitsPage.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── components/
│   │   │   │   │   ├── GovernanceView.tsx (~39 Ko)
│   │   │   │   │   ├── KpiCard.tsx
│   │   │   │   │   ├── OperatorView.tsx
│   │   │   │   │   └── SiteAdminView.tsx (~91 Ko — plus lourd)
│   │   │   │   └── hooks/
│   │   │   │       ├── useDashboardStats.ts
│   │   │   │       └── useForceSyncActions.ts
│   │   │   ├── AdminCentre/
│   │   │   │   ├── AdminCentreLayout.tsx
│   │   │   │   └── views/DashboardView.tsx
│   │   │   ├── AgentVerification/
│   │   │   │   ├── AgentVerificationLayout.tsx
│   │   │   │   └── views/
│   │   │   │       ├── Overview.tsx
│   │   │   │       ├── RechercheView.tsx
│   │   │   │       └── SignalementsView.tsx
│   │   │   ├── AgentSaisie/
│   │   │   │   ├── AgentSaisieLayout.tsx
│   │   │   │   ├── components/SaisieEditModal.tsx
│   │   │   │   └── views/
│   │   │   │       ├── Overview.tsx
│   │   │   │       ├── NouvelleSaisieView.tsx
│   │   │   │       ├── HistoriqueView.tsx
│   │   │   │       └── MesBrouillonsView.tsx
│   │   │   ├── AgentQualite/
│   │   │   │   ├── AgentQualiteLayout.tsx
│   │   │   │   └── views/
│   │   │   │       ├── Overview.tsx
│   │   │   │       ├── DoublonsView.tsx
│   │   │   │       ├── MissingDataView.tsx
│   │   │   │       ├── InvalidFormatView.tsx
│   │   │   │       ├── AnomaliesBrutesView.tsx
│   │   │   │       └── GlobalSearchView.tsx
│   │   │   ├── VerificationSearchPage/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── components/
│   │   │   │   └── hooks/
│   │   │   └── inventaire/
│   │   │       ├── InventaireLayout.tsx
│   │   │       ├── InventaireApurement.tsx
│   │   │       ├── InventaireLogistique.tsx
│   │   │       └── InventairePhysiqueScan.tsx
│   │   └── utils/dateValidator.ts
│   │
│   └── shared/
│       ├── types.ts
│       ├── types/quality.types.ts
│       └── utils/
│           ├── date.ts          [NON DOCUMENTÉ AVANT]
│           └── validators.ts   [NON DOCUMENTÉ AVANT]
│
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── package.json  (v2.7.0)
└── supabase_schema.sql
```

---

## 🗄️ 4. Base de Données SQLite (Locale)

**Moteur** : better-sqlite3 ^11.7.0, mode WAL, **SCHEMA_VERSION = 55** ✅ Confirmé

### Migrations Complètes (v1 → v55)

| Version | Description |
|---|---|
| v1 | Initial schema (toutes les tables de base) |
| v2 | Ensuring tables |
| v3 | Adding retirant columns to temp table |
| v4 | Adding quotas to sites |
| v5 | Adding active status to sites |
| v6 | Catch-up site_id columns |
| v7 | Final schema consistency check |
| v8 | Adding composite index (site_id, statut) to t_cartes |
| v9 | Migrating date formats DD/MM/YYYY → YYYY-MM-DD |
| v10 | Updating statut_physique CHECK constraint (PERDUE) |
| v11 | Adding prefixe_rangement to t_sites |
| v12 | Moving prefixe_rangement to t_centres |
| v13 | Adding is_exported to t_cartes |
| v14 | Adding created_by + AJOUTANT → OPERATEUR_SAISIE |
| v15 | CONSULTANT → OPERATEUR_VERIFICATION |
| v16 | Adding OPERATEUR_INVENTAIRE role |
| v17 | EDITEUR → OPERATEUR_QUALITE |
| v18 | ADMINISTRATEUR → ADMINISTRATEUR_SITE + ADMIN_CENTRE |
| v19 | Creating composite index idx_cartes_identite_civile |
| v20 | Optimizing indices and logs performance |
| v21 | Creating t_audit_logs table |
| v22 | Creating t_user_roles table |
| v23 | Mass upload indexes (cle_doublon, is_dirty, site_id) |
| v24 | Unique indexes for sync_id on t_cartes + t_users |
| v25 | Creating t_import_anomalies table |
| v26 | Indexing date_delivrance and created_at |
| v27 | is_dirty NOT NULL + synced_at to t_users |
| v28 | Ensuring t_import_anomalies for stats dashboard |
| v29 | Ensuring t_import_anomalies + updating t_centres |
| v30 | Column numero DEFAULT 1 on t_centres |
| v31 | Column created_by + index on t_cartes |
| v32 | Creating t_outbox table (Outbox Pattern) |
| v33 | Colonnes d'identité dans t_import_anomalies (catch uniquement) |
| v34 | Indexes for stats:get performance |
| v35 | Covering index for DP + KPI index |
| v36 | Index for distribParJour query |
| v37 | note_signalement_absence + escalade_niveau to t_cartes |
| v38 | Index for strict duplicates query |
| v39 | contact_retirant column to t_cartes |
| v40 | expiry_date + is_permanent to t_sites |
| v41 | has_invalid_date flag + index + triggers (O(log n)) |
| v42 | Allow DELETE operation in t_outbox |
| v43 | BROUILLON to statut CHECK constraint on t_cartes |
| v44 | is_dirty + updated_at to t_import_anomalies |
| v45 | is_dirty + updated_at to t_sites + t_centres |
| v46 | Composite indexes for stats-worker performance |
| v47 | lieu_enrolement, statut, date_delivrance to t_import_anomalies |
| v48 | updated_by column to t_cartes |
| v49 | Create t_agent_archives table |
| v50 | Add centre_id to t_import_anomalies |
| v51 | Create t_anomalies_fts (FTS5 sur anomalies) |
| v52 | Add lieu_enrolement to t_import_anomalies (alignement) |
| v53 | Full alignment of t_import_anomalies with t_cartes |
| v54 | Reconstruction t_cartes (CHECK contrainte), clean redundant index, safe triggers |
| v55 | Migration t_outbox.depends_on (Garantie de séquence) |

### Tables Principales

| Table | Description |
|---|---|
| `t_cartes` | Table centrale. |
| `t_users` | Utilisateurs. |
| `t_sites` | Sites de distribution. |
| `t_centres` | Centres rattachés aux sites. |
| `t_postes` | Postes de travail. |
| `t_import_anomalies` | Anomalies import CSV. Alignée sur t_cartes depuis v53. |
| `t_outbox` | File d'attente Outbox Pattern. |
| `t_audit_logs` | Audit corrections qualité (v21). |
| `t_activity_logs` | Journal activité opérateur. |
| `t_import_temp` | Zone tampon imports. |
| `t_user_roles` | Rôles utilisateurs (v22). |
| `t_agent_archives` | Archives agents supprimés (v49). |

### Tables FTS5
- `t_cartes_fts` : noms, prenoms, num_secu, rangement.
- `t_anomalies_fts` : noms, prenoms anomalies (v51).
- Triggers SQLite maintiennent les index automatiquement.

### Colonnes Clés `t_cartes`
```
id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance,
num_secu, contact, rangement, sexe, statut, statut_physique,
site_id, centre_id, created_by, updated_by (v48),
is_dirty, is_exported, sync_id, cle_doublon,
date_delivrance, nom_retirant, relation_retirant, agent_distributeur,
contact_retirant (v39), note_signalement_absence (v37),
escalade_niveau (v37), has_invalid_date (v41)
```

---

## 🔌 5. Architecture IPC

Tout passe par **contextBridge** → `window.api`.

### Namespaces (Audités 2026-07-27)

```typescript
window.api.auth.*        // login, logout, onSessionExpired, onAuthWarning, isPreloadingUsers,
                         // onPreloadStatus, updateSelfProfile, registerSuperAdmin
window.api.cartes.*      // CRUD, recherche, doublons, données manquantes, absences,
                         // pertes, inventaire, signalements, qualité
window.api.logistique.*  // recevoirLot, triCartes, transfertCentre, inventairePhysique
window.api.stats.*       // get, getCentre, getCentreOperateurs, getGlobal, getVerification,
                         // getCardsToday, getAgentToday, getAgentRecentSaisies,
                         // getSiteSaisieToday, getSiteQualiteToday, getSiteLogistiqueToday,
                         // getActivitiesByAgentAndDate, getRetraits, getRetraitsTrend,
                         // getUnsyncedCardsCount, getDetailedSyncStats,
                         // getUnsyncedUsersCount, getUnsyncedCentresCount
window.api.import.*      // selectFile, parseCSV, executeBatch, clearTemp, processFile,
                         // fusionner, getAnomalies, clearAnomalies, deleteAnomaly,
                         // updateAnomalyField, countEmptyAnomalies, deleteEmptyAnomalies,
                         // onProgress
window.api.qualite.*     // fusionnerDoublons, corrigerFormat, supprimerIncoherences,
                         // assainirGlobal, auditDates, onAuditProgress
window.api.export.*      // csv, excel, pdf, getRangements, marquerExporte, getRows, onPdfProgress
window.api.users.*       // getAll, getProfile, create, update, delete, hardDelete, resetAgentPassword
window.api.hierarchy.*   // getSites, getSitesSummary, createSite, updateSite, deleteSite,
                         // resetAdminPassword, verifyPassword, getCentres, getCentreById,
                         // createCentre, updateCentre, deleteCentre, getPostes,
                         // pullCentres, forceCentres
window.api.logs.*        // get, add, purge, consultation, export
window.api.audit.*       // getPage, delete
window.api.config.*      // get, set, getAll
window.api.window.*      // minimize, maximize, close, isMaximized
window.api.notification.* // show
window.api.theme.*       // get, set
window.api.log.*         // info, error, warn
window.api.app.*         // getName, getVersion, getDbPath, exportLogs, checkFirstLaunch,
                         // openExternal, openExternalUrl
window.api.database.*    // getCardsCount, export, import
window.api.db.*          // purge, emergencyPurge, getCardCount, onPurgeProgress
window.api.sync.*        // getStatus, getCloudCartesCount, getTotalCloudCartesCount, force,
                         // forcePing, retryConnection, getAutoDownstream, setAutoDownstream,
                         // onStatusChanged, startBulk, onBulkProgress, cancelBulk,
                         // getUnreadCount, getUnreadList, markAsRead, markNotificationAsRead,
                         // forceGlobal, forceSite, pullSiteCards, pullAgents,
                         // syncUsersFromSupabase, forceAgents, onAutoDownstream,
                         // onDownstreamProgress
window.api.maintenance.* // clearAll, clearDatabaseCartes, clearCloudCartes, fullReset,
                         // purgeEmptyRows, getLogs, clearLogs, exportLogs,
                         // analyzeUploadedLogs, onPurgeCloudProgress
window.api.updater.*     // check, download, install, onUpdateAvailable, onUpdateNotAvailable,
                         // onDownloadProgress, onUpdateDownloaded, onError
window.api.debug.*       // getAllAnomalies
window.api.onDatabaseUpdated  // Listener global sync:updated-data
```

### ⚠️ Règle Critique IPC
`src/preload/global.d.ts` = **SOURCE DE VÉRITÉ des types TypeScript**.
Toute nouvelle API IPC doit être déclarée dans ce fichier AVANT d'être utilisée dans le renderer.

---

## 🔄 6. Moteur de Synchronisation Supabase

### Deux Cycles Coexistants
```
CYCLE COURT (5–30 min adaptatif)  → UPSTREAM uniquement
  Pousse t_outbox vers Supabase. Backoff exponentiel.

CYCLE LONG  (2h, post-login)      → DOWNSTREAM uniquement
  Rapatrie cartes cloud → SQLite.
  Déclenché 10s après login, puis toutes les 2h.
  Sauté si offline.
```

### Workers Dédiés (4 confirmés)
- **`stats-worker.js`** : KPI Dashboard (thread séparé — ne bloque PAS le Main Thread).
- **`download-worker.js`** : Pull downstream asynchrone.
- **`upload-worker.js`** : Push upstream asynchrone.
- **`import-worker.js`** : Traitement CSV (thread séparé).

---

## 👥 7. Système de Rôles et Portails

| Rôle | Portail | Accès |
|---|---|---|
| `SUPER ADMIN` | Dashboard global | Tout |
| `ADMINISTRATEUR_SITE` | Dashboard site | Son site |
| `ADMIN_CENTRE` | Portail Admin Centre | Son centre |
| `OPERATEUR_SAISIE` | Portail Saisie | Saisie, brouillons, historique |
| `OPERATEUR_VERIFICATION` | Portail Vérification | Recherche, signalements |
| `OPERATEUR_QUALITE` | Portail Qualité | Doublons, manquants, invalides |
| `OPERATEUR_INVENTAIRE` | Hub Inventaire | Inventaire physique, logistique |
| `OPERATEUR_LOGISTIQUE` | Hub Inventaire | Logistique des lots |

---

## 🎨 8. Design System UI

- **Glassmorphism** : fond semi-transparent, backdrop-blur, bordures subtiles.
- **Thème Dark** : `#080c16`, `#0a0e1a`, `#111827`.
- **Couleurs Accent** : Bleu `#70a1ff`, Vert `#2ed573`, Orange `#f59e0b`, Rose `#ec4899`.
- **Micro-animations** : `animate-fade-in`, `hover-premium`.
- **Composants clés** : `GlobalConfirmModal` + `confirmService`, `PaginationInput`, `DateInput`, `ExpandedAnomalyDetails`, `OnlineBadge`, `RoleRedirect`, `CentreContextSwitcher`.

---

## 🛠️ 9. Module Qualité & Anomalies

### Calcul du TOTAL CARTES (Dashboard)
`Total = COUNT(t_cartes) + COUNT(t_import_anomalies WHERE type_anomalie = 'DATE_INVALIDE')`

### Anti-Freeze UX (Implémenté 2026-07-27)
- `qualityUIStore.isFetchingQuery` : booléen Zustand partagé.
- Chaque `loadTabData()` → `setIsFetchingQuery(true)` début, `false` dans `finally`.
- `AgentQualiteLayout.tsx` → `pointer-events: none; opacity: 0.6` sur nav si `isFetchingQuery = true`.

### Vues (`/agent-qualite/*`)

| Vue | Route | Description |
|---|---|---|
| Overview | `/agent-qualite` | Compteurs cliquables |
| DoublonsView | `/agent-qualite/doublons` | Doublons stricts et probables |
| MissingDataView | `/agent-qualite/manquants` | Sans sécu, nom, prénom, contact, lieu, rangement |
| InvalidFormatView | `/agent-qualite/invalides` | Formats invalides |
| AnomaliesBrutesView | `/agent-qualite/anomalies-brutes` | Rejets d'import CSV |
| GlobalSearchView | `/agent-qualite/recherche-universelle` | Recherche cross-tables |

### Composant `ExpandedAnomalyDetails`
Partagé entre toutes les vues. Édition en ligne pour : Noms, Prénoms, DDN, Contact (10ch), Lieu naissance, N° Sécu (13ch), Rangement.

### Tokenized Search
Split de la chaîne par espaces. Chaque token doit être présent dans les champs. Résout NOM+PRÉNOM sur champs séparés en BDD.

---

## 💻 10. Technologies

| Couche | Technologie | Version (package.json) |
|---|---|---|
| Desktop | Electron | ^34.5.8 |
| Bundler | electron-vite | ^2.3.0 |
| Langage | TypeScript | ^5.7.0 (strict) |
| UI | React | ^19.0.0 |
| Routing | react-router-dom | ^7.1.0 |
| State | Zustand | ^5.0.3 |
| BDD locale | better-sqlite3 | ^11.7.0 |
| BDD cloud | @supabase/supabase-js | ^2.45.0 |
| Auth | bcryptjs | ^2.4.3 |
| Icônes | lucide-react | ^0.469.0 |
| Toasts | react-hot-toast | ^2.4.1 |
| Graphiques | Chart.js + react-chartjs-2 | ^4.4.7 / ^5.2.0 |
| Virtualisation | react-window | ^1.8.10 |
| Export Excel | exceljs | ^4.4.0 |
| Export PDF | jspdf + jspdf-autotable | ^2.5.2 / ^3.8.4 |
| Logging | electron-log | ^5.2.4 |
| Packaging | electron-builder | ^26.15.3 |
| QR Code | qrcode | ^1.5.4 |
| Date utils | date-fns | ^4.1.0 |
| Debounce | lodash.debounce | ^4.0.8 |
| Config persistance | electron-store | ^10.0.0 |
| UUID | uuid | ^11.0.5 |
| Tests | vitest | ^2.1.0 |

---

## 🏛️ 11. Décisions de Design Clés

1. **Offline-First** : tout fonctionne sans réseau.
2. **Outbox Pattern** : toute mutation passe par `t_outbox` avant push cloud.
3. **WAL Mode SQLite** : meilleures performances concurrentes.
4. **FTS5** : recherche plein texte ultra-rapide.
5. **4 Workers** : Import CSV, Stats, Download, Upload — dans des threads séparés.
6. **Migrations Incrémentales** : v1→v55, ne jamais modifier les anciennes.
7. **ExpandedAnomalyDetails partagé** : cohérence UX Qualité.
8. **Tokenized Search** : NOM+PRÉNOM sur champs séparés en BDD.
9. **Portails Role-Based** : ergonomie terrain.
10. **RAM Shield (8 Go)** : mode restrictif si RAM < seuil.
11. **Anti-Freeze Qualité** : `isFetchingQuery` bloque la navigation pendant les requêtes.
12. **initialDataLoading = false** : Dashboard charge en arrière-plan. Plus de blocage au login.

---

## 🤖 12. Instructions pour un Futur Modèle IA

### RÈGLES ABSOLUES (Gouvernance TITAN)
1. ❌ **JAMAIS `npm run build`** sans instruction écrite explicite du DG.
2. ✅ **TOUJOURS `npx tsc --noEmit`** après toute modification (0 erreur requise).
3. ✅ **TOUJOURS mettre à jour `factory_memory.md`** après chaque correctif.
4. ✅ **Hermétisme** : ne modifier que ce qui est demandé.
5. ⚠️ **STOP & WARN** si module partagé ou schéma BDD touché.

### Où Chercher Quoi

| Besoin | Fichier(s) |
|---|---|
| Ajouter handler IPC | `handlers.ts` + `preload/index.ts` + `global.d.ts` |
| Modifier requête SQL | `queries/[domaine].queries.ts` |
| Changer schéma BDD | `schema.ts` — nouvelle migration numérotée |
| Ajouter une route | `App.tsx` + créer la page |
| Modifier vue Qualité | `pages/AgentQualite/views/[VueCible].tsx` |
| Modifier édition partagée | `components/Quality/ExpandedAnomalyDetails.tsx` |
| Ajouter type window.api | `preload/global.d.ts` (OBLIGATOIRE) |
| Comprendre sync | `src/main/sync/sync-engine.ts` |
| Décisions passées | `.agents/storage/factory_memory.md` |
| État auth loading | `authStore.ts` — `initialDataLoading` |
| Verrouiller nav Qualité | `qualityUIStore.ts` — `isFetchingQuery` |

### Pièges à Éviter
- ❌ Modifier les migrations existantes.
- ❌ Utiliser `window.api.xxx` sans déclaration dans `global.d.ts`.
- ❌ Dupliquer la logique d'édition (utiliser `ExpandedAnomalyDetails`).
- ❌ `loadTabData()` Qualité sans `setIsFetchingQuery(true/false)`.
- ✅ Appeler `loadTabData()` après toute mutation.
- ✅ Protéger les routes avec `ProtectedRoute` + rôles.
- ✅ Valider les dates avec `isValidCalendarDate()`.

---

## ⚠️ 13. Incohérences Connues / Dette Technique

### 8. 🔴 CRITIQUE — Absence de Tombstone et de résolution de conflits (Cartes Zombies)
- **Où** : `outbox.service.ts` (`DELETE`), `upload-worker.js` (`upsert`), `download-worker.js` (`SKIP`).
- **Problème** : Deux failles architecturales majeures corrompent la synchronisation multi-postes.
  1. **Faille A (Le Zombie)** : Une carte supprimée localement est effacée physiquement de Supabase (`.delete()`). Le `downstream` (qui fait un simple `SELECT *`) ne reçoit jamais l'information de suppression. Les autres postes gardent la carte localement pour toujours, ce qui corrompt la base et risque de la ressusciter s'ils la modifient.
  2. **Faille B (Écrasement Silencieux)** : L'envoi vers Supabase utilise un `.upsert()` brut qui écrase purement les données distantes (Last-Write-Wins niveau réseau, sans vérification du vrai `updated_at`). De plus, si un poste a une modification locale en attente (`is_dirty = 1`), il rejette délibérément les mises à jour descendantes de Supabase, ce qui garantit qu'il écrasera le travail des autres dès qu'il poussera ses données.
- **Scénarios couverts** :
  - *Scénario 1 (Suppression locale → Propagation)* : Faille A. Le poste B ne supprimera jamais la carte.
  - *Scénario 2 (Modif concurrente Poste A / Poste B)* : Faille B. Écrasement garanti.
  - *Scénario 3 (Offline delete A vs Online modif B)* : Le DELETE (A) gagne au retour réseau, mais B garde le zombie localement (Faille A).
  - *Scénario 4 (Downstream pendant modif locale)* : Couvert par Faille B (SKIP).
  - *Scénario 5 (Coupure en plein envoi)* : Géré (Outbox retry). Risque Faible.
  - *Scénario 6 (Création simultanée doublons)* : 2 lignes distinctes sur Cloud car UUID locaux différents. Risque Modéré (traité par l'outil de fusion après coup).
  - *Scénario 7 (Conflit statut LIVREE/PERDUE)* : Couvert par Faille B. Le dernier upload écrase. Risque Critique.
  - *Scénario 8 (Interaction avec fusion V55)* : Faille B + A. Un poste offline qui n'a pas vu la suppression de la source uploade sa modification et ressuscite la carte source. Risque Critique.
  - *Scénario 9 (Suppression puis re-création)* : UUIDs différents (DELETE puis INSERT). Risque Faible.
  - *Scénario 10 (Downstream pendant Upstream manuel)* : Protégé par verrous. Risque Faible.
  - *Scénario 11 (Suppression locale d'une carte non sync)* : Géré (cancelPendingInsert). Risque Faible.
- **Statut** : 🔴 CRITIQUE. Implémentation requise d'un **Soft-Delete (Tombstone)** et d'un **RPC de merge / résolution de conflit par updated_at**. En attente d'une session dédiée.

### 9. 🔴 CRITIQUE — RLS désactivé sur Supabase (surface d'exposition inter-sites)
- **Où** : Supabase (`supabase_schema.sql` lignes 190-195).
- **Problème** : La sécurité Row Level Security (RLS) est explicitement DÉSACTIVÉE (`DISABLE ROW LEVEL SECURITY`) sur les tables majeures : `t_sites`, `t_centres`, `t_postes`, `t_users`, `t_cartes`, `t_logs`. De plus, un `GRANT ALL TO anon, authenticated, service_role` donne un accès total.
- **Risque** : 🔴 CRITIQUE. La confidentialité des données entre sites repose UNIQUEMENT sur la discipline du code applicatif (filtres `site_id` dans les handlers IPC ou les requêtes Supabase). Un simple bug ou oubli dans un appel API pourrait exposer toutes les cartes de tous les sites à n'importe quel agent authentifié.
- **Statut** : Découvert le 2026-07-29 lors de l'audit de la recherche Cloud de secours. En attente d'une session dédiée de renforcement Cloud. (Mitigation provisoire : filtre `site_id` rendu OBLIGATOIRE et bloquant côté `handlers.ts`).

### 1. Double logique "Dates Invalides" (CONNUE)
- **Où** : `stats-worker.js` (Dashboard) VS `cartes.queries.ts` (Portail Qualité).
- **Problème** : Le Dashboard utilise `has_invalid_date = 1` (index v41). Le Portail utilise une requête `UNION ALL`. Les compteurs peuvent légèrement diverger.
- **Statut** : ✅ Clarifié le 2026-07-27 : logiques distinctes assumées et documentées, UI pédagogique ajoutée, requête optimisée (Note : le trigger v41 est légèrement plus strict car il ne fait pas de TRIM() avant contrôle, ce qui est assumé).

### 2. Vues Qualité : Requêtes Synchrones sur le Main Thread (MITIGÉ)
- **Où** : Toutes les views de `/agent-qualite/`.
- **Problème** : Contrairement au Dashboard (worker dédié), les pages Qualité exécutent `better-sqlite3` directement sur le Main Thread. Le gel critique est bloqué par `isFetchingQuery`, mais des micro-lags restent possibles.
- **Solution Long Terme** : Créer un `qualite-worker.js`.
- **Statut** : Mitigation UI déployée 2026-07-27.

### 3. `QualiteAssainissementPage.tsx` — Statut Unclear
- **Où** : `src/renderer/src/pages/QualiteAssainissementPage.tsx` (~72 Ko).
- **Problème** : Fichier non importé dans `App.tsx`. Remplacé par `AgentQualiteLayout` ?
- **Statut** : ✅ Supprimé le 2026-07-27, doublon mort confirmé, 0% régression.

### 4. `SaisiePage.tsx` — Probable Legacy
- **Où** : `src/renderer/src/pages/SaisiePage.tsx`.
- **Problème** : Non importé dans `App.tsx`. Le portail saisie est géré par `AgentSaisieLayout`.
- **Statut** : ✅ Requalifié le 2026-07-27 : NON legacy, composant partagé légitime utilisé par NouvelleSaisieView.tsx et SaisieEditModal.tsx.

### 5. Migration v33 — Absente du flux principal
- **Où** : `schema.ts`.
- **Problème** : `migrateV33(db)` était appelée dans le catch d'urgence mais il n'existait pas de `if (currentVersion < 33)` dans le flux principal.
- **Statut** : ✅ Corrigé le 2026-07-27. Le bloc a été ajouté, le risque résiduel est neutralisé.

### 6. Faille de Confinement Outbox & Blocage Silencieux (Dates de naissance)
- **Où** : `sync-engine.ts` (Auto Outbox) VS `upload-worker.js` (Bulk Sync manuel).
- **Problème** : L'Outbox asynchrone envoyait systématiquement les cartes mal formatées (provoquant des erreurs Postgres en boucle), tandis que le Bulk Sync manuel bloquait silencieusement toutes les cartes à date vide (pourtant acceptées par Supabase).
- **Statut** : ✅ Corrigé le 2026-07-27.
  - Déblocage de l'envoi de masse pour les dates vides (`upload-worker.js`).
  - Validation stricte ajoutée avant envoi réseau (`outbox.service.ts`).
  - **Règle Métier Implémentée** : Une carte avec `noms`, `prénoms` ET `date_de_naissance` tous vides est considérée sans identité exploitable et est formellement bloquée localement en `ERROR` (ne part jamais vers Supabase).

### 7. Crash Potentiel sur has_invalid_date et Redondance d'Index (RÉSOLU)
- **Où** : `cartes.queries.ts` (Fast Path via V1) et `schema.ts`.
- **Problème** : La migration V41 a introduit `has_invalid_date` sans mettre à jour `migrateV1`, causant un crash sur les bases neuves. De plus, 4 index d'identité redondants consommaient de l'espace et ralentissaient les écritures inutilement.
- **Statut** : ✅ Corrigé le 2026-07-28 via SCHEMA_VERSION = 55 (Migration t_outbox.depends_on pour garantir l'ordre séquentiel UPDATE → DELETE lors des fusions hors-ligne).
  - Reconstruction atomique de `t_cartes` via V54 avec unification de la contrainte CHECK (ajoutant `PERDUE` et `ABIMEE`).
  - Ajout idempotent de la colonne `has_invalid_date` et de `prefixe_rangement` sur `t_sites`.
  - Suppression de 4 index d'identité redondants, en s'appuyant désormais sur `idx_cartes_stats_dp_v2` comme "covering index".
  - Mise à jour de `migrateV1` pour qu'elle produise directement le schéma complet et optimisé.

### 10. 🟢 Dette mineure — Bouton de synchronisation dupliqué (8 occurrences)
- **Où** : `AgentVerificationLayout.tsx`, `AgentQualiteLayout.tsx`, `OperatorSaisieLayout.tsx`, `AdminCentreLayout.tsx`, `GovernanceView.tsx`, `SiteAdminView.tsx`, etc.
- **Problème** : Le bouton de synchronisation n'est pas un composant partagé. Le code HTML, le CSS (flex, couleurs) et les états de chargement (`isBulkUploading`) sont dupliqués.
- **Statut** : ✅ Libellés harmonisés manuellement en dur le 2026-07-29 ("Synchroniser mes actions", "Envoyer les corrections", etc.) pour éviter la confusion. Un futur refactoring vers un composant `<SyncButton label="..." loadingLabel="..." onClick={...} />` reste fortement recommandé si le design de l'application doit évoluer.

---

## 📜 14. Dernières Modifications Importantes

| Date | Modification | Fichier(s) |
|---|---|---|
| 2026-07-24 | Alignement compteur Dashboard Dates Invalides | `stats-worker.js`, `SiteAdminView.tsx` |
| 2026-07-24 | Alignement compteur Vue d'Ensemble Dates Invalides | `Overview.tsx` |
| 2026-07-24 | Tokenized Search dans requêtes Qualité | `cartes.queries.ts` |
| 2026-07-24 | Édition Date naissance & N° Sécu dans InvalidFormatView | `InvalidFormatView.tsx` |
| 2026-07-24 | Création `ExpandedAnomalyDetails` (composant partagé) | `ExpandedAnomalyDetails.tsx` |
| 2026-07-24 | Refactorisation MissingDataView et AnomaliesBrutesView | `MissingDataView.tsx`, `AnomaliesBrutesView.tsx` |
| 2026-07-24 | Ajout IPC `import:updateAnomalyField` | `handlers.ts`, `preload/index.ts`, `global.d.ts` |
| 2026-07-24 | Barre de progression dynamique au login | `MainLayout.tsx`, `authStore.ts` |
| 2026-07-24 | Fix Cold Start (ordre FTS5 dans migrateV1) | `schema.ts` |
| 2026-07-25 | Hardening Audit P0/P1/P2. GO PRODUCTION. | Multiple |
| 2026-07-27 | Fix `initialDataLoading = false` (suppression blocage UI login) | `authStore.ts` |
| 2026-07-27 | Fix route sidebar Anomalies Brutes | `Sidebar.tsx` |
| 2026-07-27 | Anti-Freeze Qualité : `isFetchingQuery` + verrouillage nav | `qualityUIStore.ts`, `AgentQualiteLayout.tsx`, 6 views |
| 2026-07-27 | Audit complet + mise à jour intégrale GEMINI.md | `GEMINI.md` |
| 2026-07-27 | Correction anomalie architecturale : ajout flux migration v33 | `schema.ts` |
| 2026-07-27 | Suppression QualiteAssainissementPage (doublon mort) | `QualiteAssainissementPage.tsx`, `App.tsx` |
| 2026-07-27 | Clarification Dates Invalides (Scénario C) | `SiteAdminView.tsx`, `AgentQualiteLayout.tsx`, `InvalidFormatView.tsx`, `cartes.queries.ts`, `Overview.tsx` |
| 2026-07-27 | Sécurisation Outbox + Déblocage dates vides Bulk Sync | `upload-worker.js`, `outbox.service.ts` |
| 2026-07-28 | Migration V54: Safe rebuild t_cartes, clean indexes, safe V1 | `schema.ts` |

---

*Dernière mise à jour : 2026-07-27 — Correctifs Outbox & Blocage Silencieux — Factory TITAN (Agent 0 Orchestrator)*

