# GEMINI.md — GEST-IN-SITU : Guide de Contexte Complet

> **Dernière mise à jour** : 2026-07-04
> **Ce fichier** est la source de vérité pour tout modèle IA travaillant sur ce projet.
> Lis-le en entier avant de modifier quoi que ce soit.

---

## 1. Vue d'Ensemble du Projet

**GEST-IN-SITU** est une application desktop de gestion logistique pour le cycle de vie des **cartes CMU** (Couverture Maladie Universelle) en Côte d'Ivoire, déployée sur le terrain dans la commune d'Abobo et potentiellement d'autres sites.

**Problème résolu** : Suivi de 200 000+ cartes CMU depuis leur réception (EN STOCK) jusqu'à leur distribution aux assurés (DELIVRE), avec gestion des absences physiques, des doublons, et de l'organisation hiérarchique multi-sites.

**Auteur** : EBYCHOCO  
**Licence** : MIT  
**Repository** : `https://github.com/ebycoco/GEST-IN-SITU`

---

## 2. Stack Technique

| Couche           | Technologie                         | Version   | Rôle                                         |
|------------------|-------------------------------------|-----------|----------------------------------------------|
| **Runtime**      | Electron                            | 34.x      | Application desktop multi-plateforme          |
| **Build**        | electron-vite                       | 2.x       | Bundler pour main/preload/renderer            |
| **Packaging**    | Electron Forge                      | 7.x       | Création d'installateurs (Squirrel, DMG, ZIP) |
| **Frontend**     | React                               | 19.x      | UI déclarative                                |
| **Routing**      | react-router-dom                    | 7.x       | Navigation SPA (HashRouter)                   |
| **State**        | Zustand                             | 5.x       | State management minimaliste                  |
| **Styling**      | CSS vanilla (variables custom)      | —         | Thème dark segmenté (variables, base, layout, components, pages) |
| **Base de données** | better-sqlite3                   | 11.x      | SQLite embarqué, synchrone, ultra-rapide      |
| **Base Cloud**   | Supabase JS client                  | 2.x       | Piliers de synchronisation en arrière-plan    |
| **Recherche**    | SQLite FTS5                         | intégré   | Recherche full-text instantanée               |
| **Auth**         | bcryptjs                            | 2.x       | Hash de mots de passe (local)                 |
| **Charts**       | Chart.js + react-chartjs-2          | 4.x / 5.x| Graphiques du dashboard                       |
| **Export**        | ExcelJS, jsPDF + jspdf-autotable   | —         | Export CSV/Excel et PDF                       |
| **Notifications**| react-hot-toast                     | 2.x       | Toasts de feedback                            |
| **Icons**        | lucide-react                        | 0.469     | Icônes SVG modernes                           |
| **Virtualisation**| react-window                       | 1.x       | Scroll virtualisé pour listes massives        |
| **QR Code**      | qrcode                              | 1.x       | Génération de QR codes                        |
| **UUID**         | uuid                                | 11.x      | Identifiants uniques pour la sync             |
| **Dates**        | date-fns                            | 4.x       | Manipulation de dates                         |
| **Logging**      | electron-log                        | 5.x       | Logs structurés main/renderer                 |
| **Updates**      | electron-updater                    | 6.x       | Auto-update via GitHub Releases               |
| **Persistence**  | electron-store                      | 10.x      | Config persistante (settings locaux)          |

---

## 3. Architecture Globale

L'application suit l'architecture **Electron 3 processus** :

```
┌──────────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js - src/main/)            │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐  │
│  │  database/   │ │   ipc/       │ │  workers/    │ │  sync/   │  │
│  │  connection  │ │  handlers    │ │ import-worker│ │ engine,  │  │
│  │  schema (v9) │ │              │ │  (thread)    │ │ client,  │  │
│  │  queries     │ │              │ │              │ │ upstream │  │
│  └─────────────┘ └──────────────┘ └──────────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐               │
│  │ auth/    │ │ backup   │ │ updater             │               │
│  │ bcrypt   │ │ SQLite   │ │ electron-updater    │               │
│  └──────────┘ └──────────┘ └─────────────────────┘               │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ contextBridge (IPC)
┌─────────────────────────────────┴────────────────────────────────┐
│                  PRELOAD SCRIPT (src/preload/index.ts)           │
│  Expose `window.api` avec toutes les méthodes et types           │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ window.api.*
┌─────────────────────────────────┴────────────────────────────────┐
│                 RENDERER PROCESS (React SPA - src/renderer/)     │
│  ┌────────────┐ ┌───────────┐ ┌──────────────────┐ ┌──────────┐  │
│  │  pages/    │ │ components│ │ stores/          │ │  styles/ │  │
│  │  13 pages  │ │ layout/   │ │ authStore.ts     │ │ index.css│  │
│  │            │ │ shared    │ │ (Zustand)        │ │  (split) │  │
│  └────────────┘ └───────────┘ └──────────────────┘ └──────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Structure des Fichiers

```
GEST_IN-SITU_CARTE_ABOBO_V2/
├── .env                          # Configuration d'environnement (Supabase)
├── .env.example                  # Template des variables d'environnement
├── electron.vite.config.ts       # Config build Electron (aliases, plugins, outDir=dist/)
├── forge.config.cjs              # Config Electron Forge (packaging → out/)
├── installer.iss                 # Script Inno Setup pour l'installateur Windows
├── package.json                  # Dépendances et scripts (main=./dist/main/index.js)
├── tsconfig.json                 # Config TypeScript
├── supabase_schema.sql           # Schéma Supabase (Miroir PostgreSQL)
├── database.sqlite               # DB locale SQLite (SCHEMA_VERSION = 9)
│
├── resources/
│   └── icon.ico                  # Icône de l'application (Windows)
│
├── scripts/
│   ├── reset.sql                 # Script SQL de reset manuel
│   └── reset_db.js               # Script Node.js de reset de la DB
│
├── src/
│   ├── main/                     # ← PROCESSUS PRINCIPAL (Node.js)
│   │   ├── index.ts              # Point d'entrée Electron (createWindow, setup)
│   │   ├── backup.ts             # Backup WAL-safe automatique SQLite
│   │   ├── updater.ts            # Auto-update via GitHub Releases
│   │   │
│   │   ├── auth/
│   │   │   └── local-auth.ts     # Hash/Verify bcryptjs
│   │   │
│   │   ├── database/
│   │   │   ├── connection.ts     # Singleton SQLite, pragmas perf, init
│   │   │   ├── schema.ts         # Migrations versionnées (v1→v9)
│   │   │   └── queries.ts        # Requêtes et mutations SQL (verrous, sync queue)
│   │   │
│   │   ├── sync/                 # ← ENGIN DE SYNCHRONISATION CLOUD
│   │   │   ├── supabase-client.ts # Initialisation et Auth hybride par site
│   │   │   ├── network-monitor.ts # Machine à 4 états (ONLINE/OFFLINE/PROBING/DEGRADED)
│   │   │   ├── sync-engine.ts    # Boucle de synchronisation (30s)
│   │   │   ├── upstream.ts       # Push séquentiel (par lot de 50) via t_sync_queue
│   │   │   ├── downstream.ts     # Pull de mise à jour cloud -> local avec résolution
│   │   │   └── bulk-uploader.ts  # Bulk sync initial par blocs de 5000 lignes
│   │   │
│   │   ├── ipc/
│   │   │   └── handlers.ts       # Enregistrement de TOUS les handlers IPC
│   │   │
│   │   └── workers/
│   │       └── import-worker.js  # Worker thread pour import CSV massif (Clés étrangères ON)
│   │
│   ├── preload/
│   │   ├── index.ts              # Bridge contextBridge → window.api
│   │   └── global.d.ts           # Types globaux (Window.api)
│   │
│   └── renderer/
│       ├── index.html            # Point d'entrée HTML
│       └── src/
│           ├── main.tsx           # Montage React (ReactDOM.createRoot)
│           ├── App.tsx            # Routes, Toaster, ProtectedRoute
│           │
│           ├── assets/
│           │   └── styles/
│           │       ├── index.css  # Fichier principal important les modules
│           │       └── modules/   # refactoring modulaire du CSS
│           │           ├── variables.css   # Variables CSS thématiques (Dark mode)
│           │           ├── base.css        # Styles de base, animations et reset
│           │           ├── layout.css      # TopBar, Sidebar, Grilles
│           │           ├── components.css  # Form-inputs, boutons, modals
│           │           └── pages.css       # Style du Dashboard, des pages et Switchers
│           │
│           ├── components/
│           │   ├── DateInput.tsx          # Input date avec validation
│           │   ├── RoleRedirect.tsx       # Redirection automatique par rôle
│           │   ├── SyncWidget.tsx         # Widget visuel de l'état de synchronisation
│           │   └── layout/
│           │       ├── MainLayout.tsx     # Layout général
│           │       ├── Sidebar.tsx        # Navigation avec invitation et masquage dynamique
│           │       ├── TopBar.tsx         # Barre supérieure
│           │       └── CentreContextSwitcher.tsx  # Sélecteur de centre actif
│           │
│           ├── pages/
│           │   ├── LoginPage.tsx                 # Authentification
│           │   ├── DashboardPage.tsx             # Dashboard (stats isolées, Mass Sync Initial)
│           │   ├── CartesPage.tsx                # Gestion des cartes
│           │   ├── ImportPage.tsx                # Import CSV massif non-bloquant
│           │   ├── SearchPage.tsx                # Recherche rapide FTS5 (admin/opérateur)
│           │   ├── VerificationSearchPage.tsx    # Recherche en lecture seule (consultant)
│           │   ├── SaisiePage.tsx                # Saisie manuelle de cartes (ex-AjoutantSaisiePage)
│           │   ├── QualiteAssainissementPage.tsx  # Interface d'assainissement qualité
│           │   ├── AdminCentreDashboardPage.tsx  # Dashboard par centre (admin)
│           │   ├── AgentsPage.tsx                # CRUD utilisateurs/agents
│           │   ├── SitesPage.tsx                 # Gestion multi-sites
│           │   ├── AdminQueuePage.tsx            # File d'attente admin (sync queue)
│           │   ├── ExportPage.tsx                # Export des données
│           │   ├── InventairePage.tsx            # Inventaire des cartes
│           │   ├── LogistiquePage.tsx            # Page logistique
│           │   ├── RetraitsPage.tsx              # Gestion des retraits
│           │   ├── LogsPage.tsx                  # Journal d'audit
│           │   └── ProfilePage.tsx               # Profil utilisateur
│           │
│           └── stores/
│               └── authStore.ts           # État auth + contexte site/centre (Zustand)
│
├── dist/                          # ← Compilation electron-vite (INCLUS dans app.asar)
│   ├── main/index.js              #   Bundle processus principal
│   ├── main/workers/import-worker.js  # Worker copié par copyWorkerPlugin
│   ├── preload/index.js           #   Bundle preload
│   └── renderer/                  #   Assets React compilés
│
└── out/                           # ← Sortie Electron Forge (EXCLU de app.asar)
    ├── GEST-IN-SITU-win32-x64/    #   Application packagée finale
    │   └── resources/
    │       ├── app.asar           #   Archive contenant dist/ + node_modules
    │       └── app.asar.unpacked/ #   Modules natifs (better-sqlite3, *.node)
    └── make/                      #   Distributables (ZIP, installateurs)
```

---

## 5. Modèle de Données (SQLite / PostgreSQL)

L'application utilise un modèle de données unifié. Supabase utilise un schéma PostgreSQL miroir (les colonnes locales sont mappées pour correspondre).

### Tables principales

| Table            | Description                                      | Volume estimé |
|------------------|--------------------------------------------------|---------------|
| `t_cartes`       | Cartes CMU (table principale)                    | 200 000+      |
| `t_sites`        | Sites de déploiement (multi-tenant)              | ~10           |
| `t_centres`      | Centres au sein d'un site                        | ~40           |
| `t_postes`       | Postes au sein d'un centre                       | ~160          |
| `t_users`        | Utilisateurs/agents                              | ~50           |
| `t_logs`         | Journal d'audit de toutes les actions            | illimité      |
| `t_import_temp`  | Table temporaire pendant l'import CSV            | transitoire   |
| `t_sync_queue`   | File d'attente pour synchronisation offline       | transitoire   |
| `t_config`       | Configuration clé/valeur de l'application        | ~10 entrées   |
| `t_cartes_fts`   | Index FTS5 sur t_cartes (recherche instantanée)  | miroir        |

### Hiérarchie des données
```
Site (ex: ABOBO, YOPOUGON)
  └── Centre (ex: CENTRE 1, CENTRE 2)
       └── Poste (ex: POSTE 1, POSTE 2)
            └── Carte CMU (l'objet principal)
```

### Statuts des cartes et statuts physiques
*   **Statuts** : `EN STOCK` (reçue), `DELIVRE` (remise à l'assuré ou mandataire, remplace les anciens statuts `DISTRIBUEE`/`RETIRE`), `ANNULE` (carte annulée).
*   **Statuts Physiques** : `OK` (présente), `ABSENT` (signalée manquante), `RETROUVE` (retrouvée après signalement).

### Type des dates
*   Les dates de naissance (`date_de_naissance`) sont stockées au format standard ISO **`YYYY-MM-DD`** en local (SQLite) et sur le Cloud (PostgreSQL).

### 5.4 Nettoyage et Normalisation des Données (Data Cleansing)
Les fonctions de nettoyage `cleanBirthDate` et `normalizeContact` sont injectées de manière identique et synchronisée dans `src/main/sync/downstream.ts` et au cœur du script du Worker Thread `src/main/workers/import-worker.js`.
- **Dates Hybrides (`cleanBirthDate`)** : Convertit le format ISO, le format standard `JJ/MM/AAAA` et le format littéral Excel (ex: `1-févr.-1997`). Intègre des signatures exclusives pour éliminer les collisions de lettres entre les mois (Février commence par `f`, Novembre par `n`, Avril par `av`, Août par `a`) et est totalement immunisé contre les corruptions d'encodage (ex: `f├®vr` ou `d├®c` générés par Excel/ANSI).
- **Contacts (`normalizeContact`)** : Extrait uniquement les chiffres, retire le préfixe pays `225` s'il est au début pour isoler les 10 chiffres locaux, et formate sous la forme exacte `+225 XX XX XX XX XX`. Si le numéro local ne fait pas exactement 10 chiffres, applique le fallback de sécurité `+225 00 00 00 00 00`.

### 5.5 Cycle de Purge & Fluidité UI
L'instruction de suppression globale dans `queries.ts` désactive temporairement les clés étrangères (`foreign_keys = OFF`). Pour éviter le blocage synchrone du thread principal (freeze de l'UI pendant l'importation de 238k lignes), l'instruction lourde `db.prepare("VACUUM").run()` est déportée de manière asynchrone dans un `setTimeout(..., 500)`. Le succès `{ success: true }` est renvoyé immédiatement à l'interface utilisateur.

---

## 6. Architecture de Synchronisation Offline-First

L'application dispose d'un moteur de synchronisation bidirectionnel et résilient, conçu pour faire face aux coupures réseau fréquentes sur le terrain.

### 6.1 Network Monitor (Machine à 4 états)
Le module détecte en permanence l'état de la connexion Internet et exécute une machine d'états à 4 positions :
*   `ONLINE` : Connexion internet établie et réactive.
*   `OFFLINE` : Pas de connexion détectée.
*   `PROBING` : Tentative active de reconnexion en cours.
*   `DEGRADED` : Connexion lente, instable ou cloud partiellement inaccessible.
Un **debounce de 3 minutes** est appliqué lors des changements d'état réseau pour filtrer et ignorer les micro-coupures de courant ou de signal sur le terrain, évitant les reconnexions incessantes du moteur.

### 6.2 Capture Dual-Track (Upstream & Downstream)
*   **Upstream (`t_sync_queue`)** : Chaque action locale (création, modification, distribution) est capturée par une transaction SQLite qui ajoute un élément ordonné dans `t_sync_queue`. Le moteur d'Upstream lit cette file et rejoue les requêtes sur le cloud par lots transactionnels de 50.
*   **Downstream (`is_dirty` & `updated_at`)** : Pour protéger les modifications locales non encore envoyées, un flag `is_dirty = 1` est apposé sur les lignes de `t_cartes`. Le Downstream télécharge les données mises à jour sur le cloud, mais n'écrase jamais les lignes locales où `is_dirty = 1`.
*   **Worker Thread et Sync de masse** : Lors de l'import massif de 200k+ lignes, pour éviter de saturer le réseau ou la file locale `t_sync_queue`, le Worker Thread ne peuple pas la file de synchronisation, mais marque simplement toutes les cartes importées avec `is_dirty = 1`. L'envoi est alors délégué au **Bulk Uploader Initial**.

### 6.3 Bulk Uploader Initial
Déclenché à la demande (depuis le Dashboard d'administration) lors d'un premier déploiement ou d'un import de masse.
- Pousse les lignes modifiées locales (`is_dirty = 1`) directement vers le Cloud par blocs de 5 000 lignes.
- L'opération est résumable en cas de déconnexion.
- Traduit les noms de colonnes locaux vers le schéma PostgreSQL de Supabase.

### 6.4 Résolution des Conflits
Les conflits de données entre le client local et le cloud sont résolus de manière déterministe :
1.  **Priorité des Statuts** : La hiérarchie irréversible des statuts l'emporte toujours : `EN STOCK (1) -> DELIVRE (2) -> ANNULE (3)`. Le statut le plus avancé gagne.
2.  **Last-Write-Wins (LWW)** : En cas de statuts identiques ou non conflictuels, la résolution s'effectue champ par champ en comparant le timestamp de mise à jour `updated_at`. La modification la plus récente l'emporte.
3.  **Anti-boucle infinie** : Les écritures avales (Downstream) mettent à jour la base locale avec `is_dirty = 0` et ne génèrent **jamais** de logs dans `t_sync_queue`.

### 6.5 Système de Notification Hybride (Direct + Différé)
Lorsqu'un cycle de synchronisation descendante réussit à intégrer des mises à jour (`processedCount > 0` dans `downstream.ts`) :
*   **Enregistrement Persistant** : L'application insère un log d'audit système spécial de type `'SYNC_UPDATE'` dans la table locale `t_logs` avec l'état non lu (`valeur_apres = '{"read": false}'`) et marqué `is_dirty = 1` pour être synchronisé sur le Cloud lors du prochain cycle Upstream.
*   **Alerte Temps Réel** : Si l'utilisateur est connecté et actif sur son poste, un événement IPC `'sync:updated-data'` est envoyé par le Main process. La vue React réceptrice dans `MainLayout.tsx` intercepte ce signal et lève instantanément un Toast thématique "Plein Soleil" (Jaune et noir, bordure jaune contrastée) via `react-hot-toast` pour notifier l'utilisateur.
*   **Badge d'Alerte Différé** : Si l'application était fermée ou le consultant déconnecté, la `TopBar.tsx` interroge le nombre de logs non lus de ce type à la connexion et à intervalle régulier via `window.api.sync.getUnreadCount`. S'il y en a, un badge thématique jaune Plein Soleil s'affiche sur la cloche. Cliquer sur l'alerte appelle `window.api.sync.markAsRead` qui passe les logs à `read: true` en base locale avec `is_dirty = 1` pour réinitialiser le badge et propager le marquage comme lu au Cloud.

### 6.6 🚨 FLUX DES ANOMALIES PHYSIQUES (CARTES ABSENTES)
1. **Signalement Consultant (VerificationSearchPage.tsx — ex-ConsultantSearchPage) :**
   - La recherche par Téléphone et État Civil intègre une fermeture chirurgicale de la modal (`setShowReportModal(false)`) dès la réussite de l'appel IPC, sans effet de rebond.
   - Sécurité Doublon : Le bouton "Signaler" est désactivé (`disabled`) si `carte.statut_physique === 'ABSENT'`, affichant "⏳ En cours de traitement par l'administration".

2. **Isolation Strict par Sous-Site / Box (Abobo Mairie, Box FHB, PK18, etc.) :**
   - Les notifications de résolution ou de perte sont strictement cloisonnées via `site_id`.
   - Seuls les consultants connectés au même `site_id` (Box) que celui qui a émis le signalement reçoivent l'alerte dans leur cloche (`TopBar.tsx`). Les autres centres sont totalement ignorés.

3. **Traitement Admin (AdminQueuePage.tsx & queries.ts — ex-EditeurMission1Page) :**
   - Saisie forcée en MAJUSCULES en temps réel pour le champ "Nouveau Rangement" via `.toUpperCase()`.
   - Deux issues possibles : 
     * Rangement trouvé -> `resoudreAbsence(id_carte, nouveau_rangement)` (Statut passe à 'OK').
     * Rangement introuvable -> `declarerPerdue(id_carte)` (Statut passe à 'PERDUE').
   - Clôture Atomique : La soumission de l'admin passe automatiquement l'ancien log 'CARTE_ABSENTE_SIGNALEE' à `read: true` pour vider instantanément la cloche de l'admin.

4. **Notifications Temps Réel & Deep Linking Consultant (TopBar.tsx) :**
   - Synchro : Le thread Main émet le signal global `sync:updated-data` après chaque action admin pour forcer le rafraîchissement instantané des cloches consultants.
   - UX Multi-jours : Au clic sur une notification 'CARTE_ABSENTE_RETROUVEE' ou 'CARTE_PERDUE_CONFIRMEE', le consultant ne subit pas de redirection vide, mais ouvre une Modal récapitulative dédiée (Plein Soleil - fort contraste) affichant le Nom, le Contact, et le Nouveau Rangement (en gros et en Jaune) ou la procédure de duplicata.

---

## 7. Sécurité & Authentification Hybride

### 7.1 Authentification Hybride par Site
*   **Auth Locale** : Les utilisateurs se connectent via leur login local crypté en Bcrypt.
*   **Auth Cloud** : Chaque site de déploiement utilise un compte de service Supabase qui lui est propre (ex: `site_abobo@gest-in-situ.local`). Lors du démarrage, l'application se connecte de manière invisible à Supabase avec ce compte.
*   **Cloisonnement RLS** : Ce compte est lié au `site_id` correspondant. Grâce à cela, les politiques de sécurité Supabase (Row-Level Security - RLS) interdisent strictement à un site d'accéder aux données d'un autre site sur le cloud (Multi-tenancy étanche).

### 7.2 Éradication des Backdoors
*   Aucune réinitialisation de mot de passe n'est exécutée en clair au démarrage.
*   Aucun bypass d'authentification ou backdoor superadmin n'est présent dans le code de requêtage de l'application.

---

## 8. Conformité de l'UI & Refactoring

### 8.1 Politique d'Accès par Rôle
*   **SUPER ADMIN** : Accès total, gestion multi-sites (Infrastructures), réinitialisations, dashboard global. Un Switcher dans la Sidebar permet de choisir le site actif. Si aucun site n'est sélectionné, une invitation claire s'affiche à la place de la navigation.
*   **ADMINISTRATEUR** : Accès au dashboard et statistiques de son propre site uniquement, gestion des agents de son site, déclenchement du Mass Sync Initial de son site.
*   **OPERATEUR_QUALITE** : Voit uniquement la page d'Assainissement et la page Cartes. Les boutons "Nouvelle Carte" et "Export CSV" lui sont masqués. Il peut modifier ou distribuer des cartes.
*   **AJOUTANT** : A uniquement accès au formulaire de saisie manuelle et au moteur de recherche. Il ne peut effectuer aucune modification ou distribution de cartes existantes.
*   **CONSULTANT** : Recherche uniquement (lecture seule). Tous les boutons d'édition, de modification, de signalement d'absence et de délivrance lui sont masqués. Un badge signale le mode lecture seule dans ses vues.

### 8.2 Refactoring CSS Modulaire
Le fichier CSS monolithique de 25 Ko a été segmenté sous `src/renderer/src/assets/styles/modules/` :
- `variables.css` : Contient la racine `:root` avec le thémage sombre premium (jaune/black).
- `base.css` : Reset global, barres de défilement, animations et squelettes.
- `layout.css` : Grilles structurelles, Sidebar, TopBar et contrôles de la fenêtre.
- `components.css` : Boutons, modales, badges de statut, formulaires.
- `pages.css` : Vues spécifiques du Login, du Dashboard et des switchers.

### 8.3 Ergonomie de Maintenance & Purge (ImportPage.tsx)
Au chargement, `ImportPage.tsx` appelle le nouveau handler IPC `db:getCardCount` (lié à `getLocalCardCount()`). Si le nombre de cartes locales est égal à 0, le bouton "Purger la base" est automatiquement désactivé (`disabled`), son opacité passe à 50% et son curseur passe en `not-allowed`. L'état réactif `isPurging` bloque toute action concurrente dans la modal.

---

## 9. Communication IPC (Main ↔ Renderer)

| Namespace      | Handlers                                                              |
|----------------|-----------------------------------------------------------------------|
| `auth`         | `login`                                                               |
| `cartes`       | `getPage`, `search`, `getById`, `create`, `update`, `delete`, `delivrer`, `signalerAbsence`, `getAbsences`, `resoudreAbsence`, `getInvalidDates`, `updateDate` |
| `stats`        | `get`, `getGlobal`                                                    |
| `import`       | `selectFile`, `parseCSV`, `executeBatch`, `clearTemp`, `processFile`, `fusionner`, `onProgress` |
| `export`       | `csv`                                                                 |
| `users`        | `getAll`, `create`, `update`, `delete`, `hardDelete`                  |
| `logs`         | `get`, `add`, `purge`                                                 |
| `hierarchy`    | `getSites`, `getSitesSummary`, `createSite`, `updateSite`, `deleteSite`, `resetAdminPassword`, `verifyPassword`, `getCentres`, `createCentre`, `updateCentre`, `getPostes` |
| `config`       | `get`, `set`, `getAll`                                                |
| `window`       | `minimize`, `maximize`, `close`, `isMaximized`                        |
| `notification` | `show`                                                                |
| `theme`        | `get`, `set`                                                          |
| `app`          | `getVersion`, `getDbPath`                                             |
| `sync`         | `getStatus`, `force`, `startBulk`, `getUnreadCount`, `markAsRead`, `onDatabaseUpdated` (Écouteur du signal de fin de synchronisation descendante Main -> Renderer) |
| `maintenance`  | `clearAll`, `clearDatabaseCartes`, `fullReset`                        |

---

## 10. Instructions pour le Développement et la Maintenance

### 10.1 Avant de Modifier la Base de Données
- Le schéma local SQLite est en version de schéma version 9 (`SCHEMA_VERSION = 9`).
- Les dates de naissance sont obligatoirement normalisées en format ISO `YYYY-MM-DD` (conversion automatique dans `cleanDate` de `import-worker.js`).
- N'altérez jamais les migrations antérieures (v1 à v9). Pour ajouter une modification de structure, incrémentez `SCHEMA_VERSION` à 10 et ajoutez une migration idempotente (`ALTER TABLE ... ADD COLUMN ...`).

### 10.2 Bonnes Pratiques de Synchronisation
- Ne jamais générer d'écritures dans `t_sync_queue` au cours des mises à jour faites par le Downstream (les queries locales doivent spécifier `is_dirty = 0`).
- Les modifications manuelles de doublons offline doivent appliquer les fonctions unifiées de normalisation des chaînes de caractères (`removeAccents` et `normalizeContact` à 10 chiffres locaux) définies dans `queries.ts` et `import-worker.js`.

---

## 11. [ÉTAT DU PROJET] — Architecture Finale du Build & Packaging

> **Date de stabilisation** : 2026-07-04

L'architecture de build repose sur une **séparation stricte de deux répertoires** :

| Répertoire | Outil producteur | Contenu | Statut dans app.asar |
|---|---|---|---|
| `dist/` | `electron-vite build` | Bundles compilés (main, preload, renderer) | ✅ **INCLUS** |
| `out/` | `electron-forge make` | Application packagée + distributables | ❌ **EXCLU** (répertoire de sortie de Forge) |

### Point d'entrée déclaré dans `package.json`

```json
"main": "./dist/main/index.js"
```

Electron démarre directement sur `dist/main/index.js`. Il n'y a **plus de fichier relais intermédiaire** (`index-relais.js` est maintenu dans le dépôt pour historique mais exclu du package).

### Contenu de `app.asar` après un build réussi

```
\dist\main\index.js
\dist\main\workers\import-worker.js
\dist\preload\index.js
\dist\renderer\index.html
\dist\renderer\assets\*
\package.json
\node_modules\...
```

Les modules natifs (`better-sqlite3`, `*.node`) sont décompressés dans `app.asar.unpacked/node_modules/` grâce à la directive `asar.unpack: '**/{*.node,*.dll,better-sqlite3/**}'`.

---

## 12. [PROCÉDURE DE BUILD] — Générer l'Installateur Windows

Suivre impérativement la séquence suivante :

### Étape 1 — Compiler et packager avec Electron Forge

```bash
# Depuis la racine du projet
npm run make:win
```

Cette commande exécute en séquence :
1. `electron-vite build` → compile les sources vers `dist/`
2. `electron-forge make --platform win32` → package l'application dans `out/GEST-IN-SITU-win32-x64/` et génère un ZIP dans `out/make/zip/`

### Étape 2 — Créer l'installateur Inno Setup

Ouvrir **Inno Setup Compiler** et compiler le script :

```
installer.iss
```

Ou en ligne de commande (si ISCC est dans le PATH) :

```powershell
# Méthode PowerShell
.\compile_installer.ps1

# Ou directement
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

L'installateur final est généré dans :
```
out\make\installer\GEST-IN-SITU-Setup.exe
```

### Étape 3 — Vérification post-build

```powershell
# Vérifier que dist/main/index.js est bien dans l'asar
npx asar list out\GEST-IN-SITU-win32-x64\resources\app.asar | Select-String "^\\dist\\"
```

Sortie attendue :
```
\dist\main
\dist\main\index.js
\dist\main\workers\import-worker.js
\dist\preload
\dist\preload\index.js
\dist\renderer
\dist\renderer\assets\*
\dist\renderer\index.html
```

### Scripts npm disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Démarrage en mode développement (hot-reload) |
| `npm run build` | Compilation seule vers `dist/` |
| `npm run make:win` | Build + package + make ZIP Windows |
| `npm run make:mac` | Build + package + make DMG macOS |
| `npm run publish` | Publication vers GitHub Releases |
| `npm run clean:dev` | Nettoie le cache Vite et relance le dev |

---

## 13. [POINTS D'ATTENTION] — Pièges Critiques de Configuration

### ⚠️ EXCLUSION AUTOMATIQUE DE `out/` PAR ELECTRON PACKAGER

Electron Packager (utilisé en interne par Electron Forge) **exclut automatiquement et sans avertissement** le répertoire `out/` lors de la création de `app.asar`. Ce comportement est codé en dur dans `@electron/packager` car `out/` est le répertoire de sortie par défaut de Forge.

**Conséquence** : Si le répertoire de compilation d'`electron-vite` est configuré sur `out/` (comportement par défaut d'anciennes versions), les fichiers compilés (`out/main/index.js`, etc.) ne seront **jamais inclus** dans l'archive `app.asar`. L'application s'installe mais ne démarre pas.

**Solution appliquée** : L'`outDir` d'`electron-vite` a été redirigé vers `dist/` dans `electron.vite.config.ts` :

```typescript
// electron.vite.config.ts
main:    { build: { outDir: 'dist/main'     } }
preload: { build: { outDir: 'dist/preload'  } }
renderer:{ build: { outDir: 'dist/renderer' } }
```

Et `package.json` pointe directement sur la compilation :

```json
"main": "./dist/main/index.js"
```

### ⚠️ Ne jamais reconfigurer `outDir` vers `out/`

Ne jamais reconfigurer `outDir` d'`electron-vite` pour qu'il pointe à nouveau vers `out/` ou l'un de ses sous-dossiers. Cela recréerait le bug de démarrage silencieux.

### ⚠️ `fs.existsSync` dans un contexte `.asar`

Les fichiers à l'intérieur d'une archive `.asar` ne sont pas de vrais fichiers sur disque. `fs.existsSync()` peut retourner `false` pour un fichier valide situé dans un asar. Préférer `require()` direct avec un bloc `try/catch`.

### ⚠️ Variables d'environnement Supabase

Les clés Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, etc.) sont injectées au moment de la **compilation** via `define` dans `electron.vite.config.ts`. Le fichier `.env` doit être présent et rempli **avant** de lancer `npm run build` ou `npm run make:win`. Ces variables ne sont **pas** lues dynamiquement au runtime dans le Main process.

---

## 14. [HISTORIQUE DES CORRECTIFS] — Résolution du Bug de Démarrage post-Installation

### Contexte

Après la première installation de GEST-IN-SITU sur une machine Windows via l'installateur Inno Setup, l'application refusait de démarrer et affichait la boîte de dialogue d'erreur Electron :

```
A JavaScript error occurred in the main process
Uncaught Exception:
Error: [index-relais] Impossible de trouver le point d'entrée principal.
Chemins testés :
C:\Program Files (x86)\GEST-IN-SITU\resources\app.asar\out\main\index.js
```

### Analyse de la cause racine

L'application utilisait un fichier `index-relais.js` comme point d'entrée (`"main": "./index-relais.js"` dans `package.json`). Ce fichier tentait de charger `out/main/index.js` (sortie par défaut d'electron-vite).

Le bug provenait d'un **comportement non documenté d'Electron Packager** : il exclut systématiquement le dossier `out/` lors de la création de l'archive `app.asar`, car c'est son propre répertoire de sortie. Ainsi :

- Lors du build de développement (`npm run dev`) : fonctionne car `out/main/index.js` existe sur disque.
- Après installation (app.asar) : le dossier `out/` est absent de l'archive → **erreur MODULE_NOT_FOUND**.

### Correctifs appliqués (2026-07-03 → 2026-07-04)

| # | Fichier | Modification |
|---|---|---|
| 1 | `electron.vite.config.ts` | `outDir` redirigé de `out/` vers `dist/` pour les 3 processus (main, preload, renderer) |
| 2 | `package.json` | `"main"` pointé directement sur `"./dist/main/index.js"` (suppression du relais) |
| 3 | `forge.config.cjs` | Patterns `ignore` mis à jour : `out/make` et `out/GEST-IN-SITU` → `dist/make` et `dist/GEST-IN-SITU` ; ajout de `index-relais.js` et `/out` aux exclusions |
| 4 | `installer.iss` | Ajout du flag `ignoreversion` sur la directive `[Files]` pour garantir la mise à jour de tous les fichiers sans vérification de version |
| 5 | `.gitignore` | Ajout de `dist/` (nouveau répertoire de build) et nettoyage du commentaire sur `out/` |

### Vérification de la résolution

Après application des correctifs, la commande :
```bash
npx asar list out\GEST-IN-SITU-win32-x64\resources\app.asar | Select-String "^\\dist\\"
```
confirme la présence de `\dist\main\index.js` dans l'archive, et l'application démarre correctement après installation.
