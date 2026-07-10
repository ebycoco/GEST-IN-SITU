# Mémoire Globale de la Factory - GEST-IN-SITU (Bible Unique)

> **Source** : Fusion complète de `Gemini.md` (676 lignes), `ARCHITECTURE_CONVENTIONS.md` et des protocoles de gouvernance de la Factory.
> **Dernière mise à jour** : 2026-07-05

---

## 1. Stack Technique

| Couche | Technologie | Version | Rôle |
|---|---|---|---|
| **Runtime** | Electron | 34.x | Desktop multi-plateforme |
| **Build** | electron-vite | 2.x | Bundler main/preload/renderer → `dist/` |
| **Packaging** | Electron Forge | 7.x | MakerZIP → `out/` |
| **Frontend** | React | 19.x | UI déclarative |
| **Routing** | react-router-dom | 7.x | HashRouter (compatible Electron) |
| **State** | Zustand | 5.x | State management minimal |
| **Styling** | CSS vanilla segmenté | — | Thème dark premium Jaune/Black |
| **DB Locale** | better-sqlite3 | 11.x | SQLite synchrone, schéma v9 |
| **DB Cloud** | Supabase JS | 2.x | PostgreSQL miroir, RLS multi-tenant |
| **Recherche** | FTS5 (intégré SQLite) | — | Index full-text instantané |
| **Auth** | bcryptjs | 2.x | Hash local des mots de passe |
| **Charts** | Chart.js + react-chartjs-2 | 4.x/5.x | Dashboard |
| **Export** | ExcelJS, jsPDF | — | CSV/Excel/PDF |
| **Notifications** | react-hot-toast | 2.x | Toasts de feedback |
| **Icons** | lucide-react | 0.469 | SVG modernes |
| **Virtualisation** | react-window | 1.x | Listes massives scroll virtualisé |
| **UUID** | uuid | 11.x | Identifiants sync |
| **Logs** | electron-log | 5.x | Logs structurés main/renderer |
| **Updates** | electron-updater | 6.x | Auto-update GitHub Releases |

---

## 2. Architecture 3 Processus Electron

```
Main Process (Node.js — src/main/)
  ├── database/  : connection.ts, schema.ts (v9), queries.ts
  ├── sync/      : supabase-client, network-monitor, sync-engine, upstream, downstream, bulk-uploader
  ├── ipc/       : handlers.ts (TOUS les canaux IPC)
  ├── workers/   : import-worker.js (Worker Thread CSV, FK ON)
  ├── auth/      : local-auth.ts (bcrypt)
  ├── backup.ts  : WAL-safe automatique
  └── updater.ts : electron-updater

Preload (src/preload/index.ts) → Expose window.api

Renderer (React SPA — src/renderer/src/)
  ├── pages/     : 18 pages (Login, Dashboard, Cartes, Import, Search, ...)
  ├── components/: Layout, Sidebar, TopBar, DateInput, SyncWidget, CentreContextSwitcher
  ├── stores/    : authStore.ts (Zustand)
  └── styles/    : index.css + modules/ (variables, base, layout, components, pages)
```

### Points critiques d'architecture build

- **`outDir` d'electron-vite → `dist/`** (JAMAIS `out/`). Electron Packager exclut automatiquement `out/` de `app.asar` car c'est son propre répertoire de sortie.
- **`package.json`** → `"main": "./dist/main/index.js"` (sans relais intermédiaire).
- **Modules natifs** (`better-sqlite3`, `*.node`) décompressés dans `app.asar.unpacked/` via `asar.unpack: '**/{*.node,*.dll,better-sqlite3/**}'`.
- **Variables `.env`** injectées au moment de la compilation (pas dynamiques au runtime).

---

## 3. Modèle de Données (SQLite v9 / PostgreSQL)

### Tables principales

| Table | Description | Volume |
|---|---|---|
| `t_cartes` | Cartes CMU (table principale + FTS5) | 200 000+ |
| `t_sites` | Sites multi-tenant | ~10 |
| `t_centres` | Centres au sein d'un site | ~40 |
| `t_postes` | Postes au sein d'un centre | ~160 |
| `t_users` | Utilisateurs/agents | ~50 |
| `t_logs` | Journal d'audit | illimité |
| `t_sync_queue` | File d'attente sync offline | transitoire |
| `t_config` | Configuration clé/valeur | ~10 |

### Hiérarchie : `Site → Centre → Poste → Carte CMU`

### Statuts des cartes
- **Statut logistique** : `EN STOCK` → `DELIVRE` → `ANNULE`
- **Statut physique** : `OK`, `ABSENT`, `RETROUVE`
- **Dates** : Format ISO `YYYY-MM-DD` en local et cloud.

---

## 4. Normalisation & Nettoyage des Données

Fonctions appliquées **identiquement** dans `downstream.ts` ET `import-worker.js` :

- **`cleanBirthDate`** : Normalise ISO, `JJ/MM/AAAA`, formats Excel littéraux (ex: `1-févr.-1997`). Immunisé contre corruptions ANSI (`f├®vr`, `d├®c`).
- **`normalizeContact`** : Extrait 10 chiffres locaux, supprime préfixe `225`, formate en `+225 XX XX XX XX XX`. Fallback : `+225 00 00 00 00 00`.
- **`VACUUM` asynchrone** : Déporté dans `setTimeout(..., 500)` pour éviter le freeze UI lors d'un import massif. `{ success: true }` est renvoyé immédiatement.

---

## 5. Synchronisation Offline-First

### Network Monitor — 4 états
`ONLINE` / `OFFLINE` / `PROBING` / `DEGRADED` — Debounce de **3 minutes** pour filtrer les micro-coupures.

### Upstream (`t_sync_queue`)
Chaque mutation locale est capturée dans `t_sync_queue`. L'engine pousse par lots transactionnels de 50 vers Supabase.

### Downstream (`is_dirty`)
Pull cloud → local. Les lignes `is_dirty = 1` (non encore envoyées) ne sont **jamais écrasées**.

### Résolution des conflits (déterministe)
1. Priorité statut : `EN STOCK < DELIVRE < ANNULE`. Le plus avancé l'emporte toujours.
2. Last-Write-Wins (LWW) sur `updated_at` pour les cas non-conflictuels.
3. Les écritures Downstream mettent `is_dirty = 0` et ne génèrent **jamais** de logs dans `t_sync_queue` (anti-boucle).

### Bulk Uploader Initial
Déclenché depuis le Dashboard admin. Pousse `is_dirty = 1` par blocs de 5 000. Résumable après déconnexion.

### Sécurité idempotence DELETE (upstream.ts)
Les erreurs 404, `PGRST116` et `23503` (Foreign Key Supabase) sur les opérations DELETE sont absorbées silencieusement comme des succès locaux.

---

## 6. Conventions de Développement & Cache (ex-ARCHITECTURE_CONVENTIONS.md)

### 🟢 Catégorie A : Pages Analytiques / Administratives
- **Rendu immédiat (0ms)** via cache Zustand (`cacheStore.ts`).
- Au montage : charger le cache → `loading = false` → lancer requête SQL en arrière-plan sans spinner.
- Mise à jour silencieuse de l'état et du cache au retour de la promesse.
- **Exemples** : Dashboard, liste d'agents, logs, rapports de retraits.

### 🔴 Catégorie B : Action Critique / Guichet
- **Temps réel absolu. Cache mémoire strictement INTERDIT.**
- Chaque affichage interroge directement SQLite ou Supabase.
- **Exemples** : Recherche d'assurés, distribution CMU, formulaires de saisie.

### Sécurisation de session
Toute nouvelle clé dans `cacheStore.ts` (catégorie A) doit être **réinitialisée** dans `clearCache()` de `authStore.ts` au logout.

---

## 7. Sécurité & Rôles

| Rôle | Accès |
|---|---|
| **SUPER ADMIN** | Accès global multi-sites, réinitialisations, Dashboard global |
| **ADMINISTRATEUR** | Son site uniquement, gestion agents, Mass Sync |
| **OPERATEUR_QUALITE** | Page Assainissement + Cartes (sans Nouvelle Carte ni Export CSV) |
| **AJOUTANT** | Saisie manuelle et recherche uniquement |
| **CONSULTANT** | Lecture seule, tous les boutons d'action masqués |

### Accès Failsafe
- **Compte Root** : Login `root` / MDP `Root@Abobo2026!` / Rôle SUPER ADMIN.
- **Inscription secrète** : Taper `/setup-super-admin` dans le champ Identifiant → Master Key : `AboboAdmin2026!Securise`.

### Auth Hybride par Site
- Auth locale via Bcrypt.
- Chaque site se connecte avec un compte de service Supabase dédié au démarrage.
- RLS Supabase interdit strictement à un site d'accéder aux données d'un autre site.

---

## 8. Packaging & Correctifs Windows 11 (installer.iss v1.0.2)

| Directive | Valeur | Raison |
|---|---|---|
| `AppVersion` | `1.0.2` | Version courante (à incrémenter manuellement) |
| `MinVersion` | `6.1` | Windows 7 SP1+ |
| `PrivilegesRequired` | `lowest` | Sans droits admin (postes terrain) |
| `DefaultDirName` | `{localappdata}\Programs\GEST-IN-SITU` | Évite le conflit UAC Win 11 |
| `[Icons] Filename` | `{app}\gest-in-situ.exe` | Nom réel généré par Electron Forge (minuscules) |
| `WorkingDir` | `{app}` | Ancrage requis pour résolution chemins SQLite |
| `IconFilename` | ❌ Supprimé | Icône compilée dans le binaire, pas de fichier séparé |
| `[UninstallDelete]` | `filesandordirs + dirifempty` | Désinstallation propre sans résidus AppData |

### Procédure de build (Agent 7)
```plaintext
Étape 0 : Incrémenter AppVersion dans installer.iss (ligne 4)
Étape 1 : npm run make:win
Étape 2 : powershell -ExecutionPolicy Bypass -File .\compile_installer.ps1
```

---

## 9. Historique des Jalons Techniques

### 2026-07-03 → 2026-07-04 — Correctif de démarrage post-installation
- **Problème** : L'app ne démarrait pas après installation (erreur `MODULE_NOT_FOUND` sur `out/main/index.js`).
- **Cause** : Electron Packager exclut automatiquement `out/` de `app.asar`.
- **Solution** : `outDir` electron-vite → `dist/`. Point d'entrée `package.json` → `"./dist/main/index.js"`. Exclusions `forge.config.cjs` mises à jour.

### 2026-07-04 — Jalons d'ergonomie & sécurité
- Réinitialisation mot de passe agents (IPC `auth:resetAgentPassword`, MDP temporaire `cnam@2026`).
- Pagination locale (10 items/page) dans `AgentsPage.tsx`.
- Verrou de 0 carte dans `VerificationSearchPage.tsx`.
- Profil autonome (`ProfilePage.tsx`) : édition + changement MDP + sync Supabase via `auth:updateSelfProfile`.
- Masque téléphonique `+225 XX XX XX XX XX` harmonisé.
- Recherche bidirectionnelle SQL (`noms || " " || prenoms` et inverse).
- Chronomètre d'import, clé composite `cle_doublon` terminée, tableau de bord de migration.
- Doublons Probables : KPI Dashboard, onglet Assainissement, badge orange.
- Boutons sync cloud avec triple garde (en cours / hors-ligne / aucun dirty).

### 2026-07-05 — Anti-sessions simultanées & Sécurisation territoriale
- Verrou anti-sessions simultanées : Heartbeat 2min, seuil 5min, déconnexion forcée IPC `onSessionExpired`.
- Isolation flux Bulk Upload (cartes) vs Force Sync (agents).
- Validation import en 2 étapes (nom centre + confirmation centres secondaires).
- Verrou territorial par préfixe de rangement dans `VerificationSearchPage.tsx`.
- Procédure de secours cartes sans rangement (Option A / Option B).
- Export PDF asynchrone via IPC `export:pdf` dans le Main process (sans limite 500 fiches).

### 2026-07-05 — Journal d'Audit Système Paginé
- **Problème** : Besoin d'un suivi sécurisé des actions critiques (connexion, déconnexion, retrait, import, synchronisation Supabase, création/modification/suppression de cartes et d'utilisateurs), limitation RAM, affichage de détails interactif, et droit de suppression des traces d'audit restreint aux administrateurs.
- **Solution** : Création de la table `audit_logs` (migration v21), écriture des requêtes SQLite (`audit.queries.ts`), interfaçage avec les triggers IPC (connexion, déconnexion, délivrance/modification/suppression de cartes, CRUD utilisateurs, et synchronisations Supabase forcées et bulk), refactoring paginé de `LogsPage.tsx` à 15 lignes max, et intégration d'un bouton de suppression d'audit (table + modal) filtré pour `SUPER ADMIN`, `ADMINISTRATEUR_SITE` et `ADMIN_CENTRE` avec confirmation et rafraîchissement réactif.

### 2026-07-06 — Correctif du gel/crash lors de la purge de la base de données
- **Problème** : Lors de la purge de la base de données (cartes + historique), le traitement synchrone par lots de 1 000 lignes dans le Main Process bloquait l'Event Loop de Node.js, ce qui figeait l'interface d'Electron ("Ne répond pas") et empêchait la mise à jour visuelle du pourcentage de progression.
- **Solution** : Transformation de `purgeLocalDatabase` en fonction asynchrone avec un Yielder (`setImmediate`) inséré dans la boucle de segmentation pour libérer le thread principal d'Electron. Passage de `currentUser` en paramètre pour enregistrer un log d'audit de validation sur la purge et rafraîchissement réactif fluide de l'UI avec retour visuel en temps réel de 0% à 100%.

### 2026-07-06 — Correctif du crash au démarrage (Cannot find module './queries')
- **Problème** : La purge automatique au démarrage des Dead Letters déclenchait une erreur de module introuvable en essayant de requérir dynamiquement `./queries` depuis `connection.ts` dans le build final flat de l'application.
- **Solution** : Suppression de l'import dynamique `require('./queries')` dans `connection.ts` et exécution en direct de la commande SQL de purge sur l'instance active `db`.

### 2026-07-06 — Correctif de l'écran noir sur le Suivi des Retraits
- **Problème** : Cliquer sur "Suivi des Retraits" provoquait un écran noir en raison d'un crash de rendu React (TypeError sur `map`). La fonction IPC `stats:getRetraits` appelait `queries.getRetraitsByCentre` qui retournait un tableau simple au lieu d'un objet `{ rows, totaux }`, et ne prenait pas en compte les paramètres de période et de centre.
- **Solution** : Réécriture complète de `getRetraitsByCentre` dans `stats.queries.ts` pour calculer le classement (rows) et les indicateurs cumulés (totaux), et renvoyer la structure attendue par la page.

### 2026-07-06 — Sécurisation de la purge forcée & Rapatriement de cartes depuis le Cloud
- **Problème** : Sécurisation du bouton de purge forcée et demande d'ajouter une option permettant à l'administrateur de site de rapatrier les cartes depuis Supabase Cloud pour mettre à jour la base locale.
- **Solution** :
  1. Sécurisation du bouton par une modal d'urgence premium où l'administrateur doit saisir "RÉPARER" pour valider l'action.
  2. Implémentation d'une option de rapatriement de cartes avec le bouton "RÉCUPÉRER LES CARTES DEPUIS LE CLOUD" déclenchant un IPC aval (`sync:pullSiteCards`).
  3. Optimisation de la fonction de synchronisation aval `runDownstream` pour traiter les données par lots (chunks) de 500 maximum avec pause asynchrone (Yielding CPU & RAM de 50ms) pour respecter scrupuleusement la Section 9 (Low-Memory Mode).

### 2026-07-06 — Validation et sécurisation du siteId pour le pull Cloud (Pont IPC)
- **Problème** : Risque d'erreur ou crash réseau si le paramètre `siteId` est manquant, incorrect ou indéterminable lors de la récupération des cartes.
- **Solution** :
  1. Ajout d'une validation stricte `!siteId || isNaN(Number(siteId))` dans le handler IPC `sync:pullSiteCards` dans `handlers.ts` et dans `runDownstream` de `downstream.ts`.
  2. Intégration d'un log système formaté `[SYNC] Démarrage du pull pour site : [siteId]` confirmant la bonne réception d'un ID valide avant d'interroger Supabase.

### 2026-07-06 — Correction du schéma de requête Supabase (t_cartes.id_site)
- **Problème** : Erreur `'column t_cartes.site_id does not exist'` lors du rapatriement aval car la table distante PostgreSQL utilise le nom de colonne `id_site` (ainsi que `id_centre` et `id_poste`).
- **Solution** :
  1. Remplacement de `.eq('site_id', siteId)` par `.eq('id_site', siteId)` dans `runDownstreamChunk` dans `downstream.ts`.
  2. Implémentation d'un mapping résilient pour convertir les clés distantes (`id_site`, `id_centre`, `id_poste`) vers les clés SQLite locales (`site_id`, `centre_id`, `poste_id`) lors des insertions, mises à jour et résolutions de conflits.

### 2026-07-06 — Synchronisation proactive & Résilience hors-ligne
- **Problème** : Besoin d'automatiser le rapatriement des cartes à l'ouverture du Dashboard pour les administrateurs de site et de sécuriser l'usage hors-ligne en interdisant le clic manuel si la connexion est coupée.
- **Solution** :
  1. Refactoring de `handlePullSiteCards` dans `useForceSyncActions.ts` pour supporter un paramètre `isAutomatic` (permettant un auto-pull discret/silencieux sans Toasts de chargement agressifs).
  2. Blocage des requêtes manuelles si `navigator.onLine` est faux avec Toast d'avertissement explicite.
  3. Blocage de tout pull concurrent si une opération est déjà active (`isPullingCards === true`).
  4. Ajout d'un effet React (`useEffect`) dans `index.tsx` (Dashboard) déclenchant la récupération proactive en arrière-plan au montage.

### 2026-07-06 — Correction de typage TypeScript (forceGlobal & forceSite)
- **Problème** : Erreur de compilation/lint TypeScript `Property 'forceGlobal' does not exist on type '{ get...'` car les fonctions d'IPC `forceGlobal` et `forceSite` n'étaient pas déclarées dans `global.d.ts`.
- **Solution** :
  1. Ajout des signatures et types de retour de `forceGlobal` et `forceSite` dans le pont global de types `global.d.ts`.
  2. Nettoyage des transtypages `as any` devenus inutiles dans `useForceSyncActions.ts`.

### 2026-07-06 — Restriction de l'auto-pull à une exécution unique par session
- **Problème** : L'auto-pull se déclenchait de manière répétée lors de chaque navigation ou retour sur l'onglet Dashboard.
- **Solution** :
  1. Ajout de la clé de session `hasPulledThisSession` dans le `sessionStorage` lors du premier chargement de `DashboardPage` dans `index.tsx`.
  2. Conditionnement de la récupération proactive à `!hasPulled`.
  3. Nettoyage de la clé de session dans `authStore.ts` au niveau de l'action `logout` pour ré-autoriser l'auto-sync lors de la prochaine connexion.

### 2026-07-06 — Harmonisation des arguments de logout (Preload & Typage)
- **Problème** : Erreur de linter TypeScript `Expected 0 arguments, but got 1` lors de la déconnexion dans `authStore.ts` car la méthode `logout` y passait l'identifiant `login` alors qu'elle était déclarée sans argument dans `global.d.ts` et `index.ts`.
- **Solution** :
  1. Ajout du paramètre optionnel `login?: string` à la méthode `logout` dans `preload/index.ts` et `preload/global.d.ts`.
  2. Transmission correcte de l'identifiant au canal IPC `auth:logout` pour permettre l'inscription correcte de la déconnexion dans les logs d'audit.

### 2026-07-06 — Formatage de notification d'auto-pull (✨ Synchronisation initiale)
- **Problème** : Nécessité de distinguer le Toast automatique d'arrière-plan du Toast de succès déclenché manuellement et de le rendre plus discret.
- **Solution** :
  1. Modification du Toast automatique de succès dans `useForceSyncActions.ts` pour afficher le message formaté `"✨ Synchronisation initiale : [X] carte(s) synchronisée(s)."` uniquement si le nombre de cartes rapatriées est strictement supérieur à 0.

### 2026-07-06 — Synchronisation proactive (Auto-Pull) unique & résilience offline
- **Problème** : Gérer de manière propre et unique par session l'auto-pull sur le Dashboard (sans dédoublement au clic de navigation interne), intercepter et afficher le bon toast lors du clic manuel offline, et réinitialiser la clé de session au logout.
- **Solution** :
  1. Modification de `index.tsx` pour déclencher l'auto-pull uniquement si `hasPulledThisSession` est absent (`null`) du `sessionStorage`, et le passer à `true` immédiatement.
  2. Harmonisation du toast d'interception hors-ligne du bouton manuel dans `useForceSyncActions.ts` : `"⚠️ Connexion Internet requise : Veuillez vous connecter pour récupérer les cartes depuis le cloud."`.
  3. Activation persistante du bouton de pull dans `SiteAdminView.tsx` pour permettre l'interception et l'affichage du toast lors du clic manuel offline.
  4. Réinitialisation complète du `sessionStorage` via `sessionStorage.clear()` dans l'action `logout` de `authStore.ts`.

### 2026-07-06 — Résolution du gel au chargement du Dashboard (getStats asynchrone & Indexation V19)
- **Problème** : L'exécution synchrone des requêtes lourdes (doublons probables/stricts, régex) de `getStats` bloquait l'Event Loop du Main Process Electron sur 200k+ cartes, provoquant le freeze "Ne répond pas". De plus, la fonction `migrateV19` était manquante dans le schéma.
- **Solution** :
  1. Implémentation de `migrateV19` dans `schema.ts` pour créer l'index composite composite haute performance `idx_cartes_identite_civile` sur `(noms, prenoms, date_de_naissance, site_id)`.
  2. Réécriture asynchrone segmentée de `getStats` dans `stats.queries.ts` en isolant chaque requête SQL lourde dans des promesses gérées par `setImmediate()` et séparées par des respirations CPU `await new Promise(...)`.

### 2026-07-06 — Entonnoir d'Envoi Cloud progressif (Mass Upload) et machine à états
- **Problème** : Gérer de manière sécurisée et guidée l'envoi de masse vers le Cloud sans corrompre les données distantes (blocage sur les doublons stricts, avertissement/forçage sur les doublons probables et les dates de naissance non conformes).
- **Solution** :
  1. Modification de `startBulk` (preload, global.d.ts et handlers.ts) pour accepter `allowProbable` et `allowInvalid`.
  2. Implémentation de requêtes d'exclusion et de filtrage dynamique SQL dans `bulk-uploader.ts` selon les passes.
  3. Retour d'anomalies structurées (`BLOCKED_STRICT`, `BLOCKED_PROBABLE`, `BLOCKED_INVALID`) par l'IPC.
  4. Intégration de la machine à états de forçage dans `useForceSyncActions.ts` et affichage d'un bloc d'action d'entonnoir premium interactif dans `SiteAdminView.tsx` avec redirection vers `/qualite` via `useNavigate()`.

---

## 10. Gouvernance de la Factory (Agent 0)

### Hub (`factory_sync.json`)
Fichier pivot de communication inter-agents. Statut `ACTIVE`/`BLOCKED`. Tickets structurés `emitter → target`.

### Aiguillage Intelligent
- **Erreur Technique** → Agent 3 (Codeur)
- **Erreur Visuelle** → Agent 2 (Designer) → Agent 3
- **Nouvelle Fonctionnalité** → Agent 1 (Architecte/PM)

### Clôture de cycle obligatoire
Après chaque correction validée par l'Agent 7 (Garde-fou), mise à jour de **deux fichiers** :
1. `.factory/factory_memory.md` (ce fichier)
2. `Gemini.md` (miroir racine)

Format d'inscription : `Date | Problème | Solution exacte validée`.

### Coupe-Circuit
`incident_count = 3` → `arbitration_required = true` → gel des opérations → prompt d'arbitrage Option A / Option B soumis à l'Humain (Précieux).
