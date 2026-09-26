# GEST-IN-SITU — Dossier de contexte complet destiné à une IA relectrice

> **À l'IA qui lit ce document.** Ce fichier a été rédigé pour que tu comprennes le projet GEST-IN-SITU de A à Z **sans avoir à poser de question**. Lis-le entièrement, puis donne ton avis critique et tes suggestions selon le format imposé en **§17**.
>
> **Qui travaille sur le projet :** le code est développé et maintenu par **Claude Code** (l'assistant de programmation d'Anthropic, modèle Claude), piloté par le propriétaire du projet (développeur unique, compte GitHub `ebycoco`, auteur `EBYCHOCO`). Tu n'as pas accès au dépôt : **tu ne modifies rien toi-même**. Pour chaque suggestion, tu dois **rédiger un prompt prêt à être transmis à Claude Code** pour qu'il l'applique (format en §17).
>
> Rédigé le **2026-09-26** par Claude Code, uniquement à partir de fichiers réellement lus dans le dépôt ce jour-là. Les chemins sont relatifs à la racine du dépôt. Tout ce qui n'a pas pu être vérifié est signalé comme tel.

---

## Table des matières

1. Résumé en 10 lignes
2. Contexte métier (CMU, terrain, acteurs)
3. Cycle de vie d'une carte
4. Hiérarchie organisationnelle et cloisonnement
5. Rôles utilisateurs et portails
6. Stack technique et dépendances
7. Architecture Electron (main / preload / renderer / shared)
8. Base de données locale SQLite
9. Moteur de synchronisation offline-first (Supabase)
10. Authentification, session, licence, présence
11. Import, export, doublons, recherche
12. Tests, CI/CD, packaging, auto-update
13. Règles de gouvernance imposées à Claude Code (CLAUDE.md)
14. Écosystème d'agents et de skills Claude Code
15. Historique et état actuel (version, travaux en cours)
16. Problèmes connus et dette technique (audit du 24/09/2026)
17. **Ce que l'on attend de toi : format des suggestions et des prompts**

---

## 1. Résumé en 10 lignes

- **GEST-IN-SITU** est une application **desktop Windows (Electron)** de gestion du cycle de vie des **cartes CMU** (Couverture Maladie Universelle) en **Côte d'Ivoire**.
- Elle est **déployée et en exploitation active** sur des postes de terrain modestes (**8 Go de RAM**), dans des centres de distribution où la connexion Internet est **intermittente**.
- Elle est **offline-first** : chaque poste a sa base **SQLite** locale (≈ **220 000 cartes** sur le site observé). Une file d'attente locale (`t_outbox`) propage les modifications vers **Supabase** (PostgreSQL cloud), et un moteur descendant rapatrie celles des autres postes.
- Elle est **multi-sites / multi-centres**. Le cloisonnement des données par `site_id` / `centre_id` est une exigence de sécurité absolue.
- **10 rôles** (dont 1 obsolète). Chaque opérateur a un portail dédié : saisie, vérification/délivrance, qualité, logistique, inventaire, apurement. S'y ajoutent l'admin de centre, l'admin de site et le super admin. Un compte peut cumuler plusieurs rôles.
- Stack : **Electron 34, React 19, TypeScript 5.7, better-sqlite3 11 (WAL + FTS5), Supabase JS 2, zustand 5, electron-vite 2, Vitest 2, Playwright 1.62**.
- Version publiée : **2.21.0** (04/09/2026). `SCHEMA_VERSION = 70`. Environ 311 commits depuis le 03/05/2026.
- Mises à jour automatiques via **GitHub Releases** et `electron-updater`.
- Le développement est réalisé par **Claude Code**. Des règles strictes (fichier `CLAUDE.md`) et 14 sous-agents spécialisés l'encadrent.
- Problème le plus grave connu : **72,7 % des cartes n'ont pas de numéro de sécurité sociale exploitable**, dont 35,4 % détruits en notation scientifique Excel (`3,84E+12`). S'y ajoute un risque de **non-synchronisation silencieuse** de certaines corrections (voir §16).

---

## 2. Contexte métier

- **CMU** : carte d'assurance maladie universelle ivoirienne. Les cartes sont produites en amont, puis livrées en lots physiques dans des **centres** où les bénéficiaires viennent les retirer.
- **Le problème résolu** : des centaines de milliers de cartes physiques doivent être **localisées** (rangement : boîte, casier), **retrouvées** quand un bénéficiaire se présente, **délivrées** avec preuve de retrait, **contrôlées** (doublons, données manquantes) et **inventoriées**. Tout cela doit fonctionner **sans réseau fiable**.
- **Données personnelles** (PII) manipulées : noms, prénoms, date et lieu de naissance, numéro de sécurité sociale (13 chiffres), contact téléphonique (10 chiffres), lieu d'enrôlement, identité du retirant.
- **Sources des données** : listings Excel/CSV fournis par l'organisme (CNAM), importés en masse. Des saisies manuelles complètent ces imports.
- **Cahiers d'émargement historiques** : avant l'application, les délivrances étaient notées sur papier. Le rôle « Apurement » saisit rétroactivement ces émargements.
- **Environnement terrain** : Windows 10/11, 8 Go de RAM, résolutions parfois basses (1366×768), opérateurs non techniciens, coupures réseau fréquentes. Tout cela impose une interface robuste et lisible, en charte claire « Plein Soleil ».

---

## 3. Cycle de vie d'une carte (`t_cartes`)

**Statut administratif** (`statut`, contrainte CHECK dans `src/main/database/schema.ts`) :
`EN STOCK`, `DELIVRE`, `DISTRIBUEE`, `RETIRE`, `ANNULE`, `BROUILLON`, `DOUBLON`.

- `BROUILLON` : saisie manuelle non encore publiée par l'opérateur de saisie (« Mes brouillons »).
- `EN STOCK` : carte présente au centre, en attente de retrait.
- `DELIVRE` : remise au bénéficiaire, avec `nom_retirant`, `num_retirant`, `relation_retirant`, `contact_retirant`, `agent_distributeur`, `centre_retrait`, `date_delivrance`.
- `DOUBLON` : déclarée manuellement comme doublon (V67). Les champs `doublon_declare_par/le`, `doublon_motif` et `statut_avant_doublon` sont renseignés, et la déclaration est annulable.

**Statut physique** (`statut_physique`, indépendant du statut administratif) : `OK`, `ABSENT`, `RETROUVE`, `PERDUE`, `ABIMEE`.
- Une carte introuvable au rangement est **signalée absente** par la vérification. Elle entre alors dans une **escalade** (`escalade_niveau` : `CENTRE` → `SITE` → `RESOLU`), traitée dans la **File d'attente de Traitement** (`AdminQueuePage`) : relocalisation, déclaration de perte, réactivation ou escalade au site.

**Autres colonnes clés** : `rangement` (emplacement physique, préfixé par centre), `cle_doublon` / `cle_doublon_flex` (détection des doublons, §11), `has_invalid_date`, `is_exported`, `sync_id` (UUID unique de synchronisation), `is_dirty` (à synchroniser), `created_at` / `updated_at` / `synced_at` / `action_at`, et les champs de correction/annulation d'apurement (V69).

---

## 4. Hiérarchie organisationnelle et cloisonnement

- **Site** (`t_sites`) : entité licenciée (`expiry_date`, `is_permanent`, `is_active`), avec au maximum `max_centres` centres (4 par défaut) et un `prefixe_rangement`.
- **Centre** (`t_centres`) : numéroté de 1 à 4, avec son propre `prefixe_rangement`. Une carte dont le rangement porte le préfixe d'un autre centre est dite « **mal-centrée** » (page dédiée côté Logistique).
- **Poste** (`t_postes`) : machine physique.
- **Règle absolue (CLAUDE.md §3)** : toute requête SQL ou tout handler IPC touchant les cartes filtre par `site_id`, et par `centre_id` quand c'est pertinent. Le rôle, le site et le centre utilisés pour ce filtrage viennent **toujours** de `getSecureCurrentUser()` (rôle **actif** de la session côté main process), **jamais** du renderer ni d'une re-lecture de `t_users.role`. Un bug de ce type a été corrigé sur 8 handlers en août 2026.

---

## 5. Rôles utilisateurs et portails

Rôles définis dans `src/shared/types.ts` et routes dans `src/renderer/src/App.tsx` (`HashRouter`, garde `ProtectedRoute` côté UI, doublée de contrôles côté serveur via `verifyUserRole` / `getSecureCurrentUser`).

| Rôle | Portail / routes | Fonctions principales |
|---|---|---|
| `OPERATEUR_SAISIE` | `/agent-saisie` (vue d'ensemble, nouvelle saisie, brouillons, historique), `/cartes` | Saisie manuelle de cartes, publication des brouillons |
| `OPERATEUR_VERIFICATION` | `/agent-verification` (vue d'ensemble, recherche, signalements), `/search` | Recherche d'une carte pour un bénéficiaire, délivrance avec preuve, déclaration de doublon, signalement d'absence |
| `OPERATEUR_QUALITE` | `/agent-qualite` (vue d'ensemble, doublons, manquants, invalides, anomalies brutes, recherche universelle) | Fusion/résolution des doublons, complétion des données, correction des formats, traitement des anomalies d'import, « Travail du jour » |
| `OPERATEUR_LOGISTIQUE` | `/inventaire/*` en portail multi-pages (vue d'ensemble, logistique, scan, cartes mal-centrées, sans rangement) | Classement physique, attribution de rangement, recentrage des cartes |
| `OPERATEUR_INVENTAIRE` | `/inventaire` (hub à onglets internes, mêmes composants) | Inventaire physique par scan |
| `OPERATEUR_APUREMENT` | `/apurement` (vue d'ensemble, travail, cartes déchargées) | Émargement rétroactif des cahiers historiques, correction et annulation |
| `ADMIN_CENTRE` | `/admin-centre/*` (tableau de bord, cartes, recherche, retraits, file d'attente, journaux, équipe) + apurement + vérification | Pilotage d'un centre |
| `ADMINISTRATEUR_SITE` | `/dashboard`, `/import`, `/export`, `/agents`, `/sites`, `/table-cartes`, `/sync/status`, `/agents/presence`, `/logs`, `/retraits`, `/admin/queue` + tous les portails opérateurs | Pilotage d'un site : import, export, comptes, monitoring de synchro |
| `SUPER ADMIN` | Tout, plus `/maintenance` (purges, y compris cloud), gouvernance multi-sites | Administration globale, licences des sites |
| `CONSULTANT` | **Aucune route** (migré vers VERIFICATION, `schema.ts` ~l.188) | Obsolète |

- **Multi-rôles** : table `t_user_roles`. Au login, un compte multi-rôles passe par `/role-selector` et peut changer de rôle actif (`RoleSwitcher`, `setActiveRole()` côté main).
- **Contexte centre** : un admin de site peut basculer de centre (`CentreContextSwitcher`).
- Une révocation de rôle, une désactivation de compte, une suspension de site ou une expiration de licence ferment la session à distance (événement `auth:onSessionExpired` avec `reason`, voir `App.tsx`).

---

## 6. Stack technique et dépendances (`package.json`)

- **Runtime** : Electron `^34.5.8`, React `^19`, react-router-dom `^7`, zustand `^5`, TypeScript `^5.7`.
- **Données** : better-sqlite3 `^11.7` (WAL, FTS5), @supabase/supabase-js `^2.45`, electron-store `^10`.
- **UI** : lucide-react (icônes), react-hot-toast, chart.js + react-chartjs-2, react-window (virtualisation), CSS maison (`src/renderer/src/assets/styles/modules/*.css`, variables CSS). Pas de framework CSS.
- **Documents** : exceljs, jspdf + jspdf-autotable, qrcode.
- **Divers** : bcryptjs (hash des mots de passe, 10 rounds), uuid, date-fns, lodash.debounce, electron-log, electron-updater.
- **Build** : electron-vite `^2.3`, Vite `^5.4`, electron-builder `^26.15`, patch-package (un patch sur `playwright-core`).
- **Tests** : Vitest `^2.1` (unitaires), @playwright/test `^1.62` (e2e sur Electron).
- **Scripts** : `dev` (`predev` = rebuild natif pour Electron), `test` (`pretest` = `npm rebuild better-sqlite3` pour Node), `test:e2e` (`pretest:e2e` = `electron-vite build`), `build`, `build:win`, `release` (`--publish always`), `lint`.

---

## 7. Architecture Electron

```
src/
  main/                 Processus principal (Node)
    index.ts            Démarrage : fenêtre (contextIsolation: true, nodeIntegration: false, sandbox: false),
                        verrou d'instance unique, splash, ensureSyncIds, init backup/sync/updater
    ipc/handlers.ts     ~7 400 lignes, 214 ipcMain.handle — point d'entrée UNIQUE de l'IPC
    database/
      connection.ts     Instance better-sqlite3 (WAL)
      schema.ts         ~3 900 lignes, migrations séquentielles, SCHEMA_VERSION = 70
      queries/*.ts      SQL par domaine : cartes (~2 900 l.), stats (~1 500 l.), users, hierarchy,
                        absence, maintenance, sync, config, import, logs, audit
    sync/               sync-engine, outbox.service, upstream, downstream, bulk-uploader,
                        payload-mapper, supabase-client, network-monitor, presence.service
    auth/               local-auth (bcrypt), session-heartbeat (getSecureCurrentUser)
    workers/*.js        import-worker (~1 500 l.), download, upload, stats (worker_threads)
    backup.ts           Sauvegarde SQLite quotidienne (API backup), rotation sur 7 fichiers
    auto-updater.ts     electron-updater (actif) ; updater.ts = code mort
    utils/audit.ts
  preload/index.ts      contextBridge → window.api.* (~700 l.), chaque méthode = ipcRenderer.invoke
  renderer/src/         React : pages/ par rôle, components/, hooks/, stores/ (zustand), utils/
  shared/               types.ts, types/quality.types.ts, utils/date.ts, utils/validators.ts
```

**Répartition des 214 canaux IPC par espace de noms** (comptage `ipcMain.handle`) : `cartes` 55, `stats` 28, `sync` 25, `hierarchy` 13, `import` 10, `cmu` 10, `maintenance` 8, `export` 7, `auth` 7, `users` 6, `app` 6, `logs` 5, `logistique` 4, `admin` 4, `retrait` 3, `queue` 3, `qualite` 3, `db` 3, `database` 3, `config` 3, `apurement` 3, `audit` 2, `presence`, `debug`, `centre` (1 chacun).

**Conventions** :
- Le renderer n'accède jamais directement à SQLite ni à Supabase : tout passe par `window.api`.
- Rafraîchissement de l'UI après une mutation : diffusion de l'événement `app:data-updated`. Six diffusions mortes `cartes:updated` ont été supprimées en septembre.
- Chaque abonnement IPC côté renderer doit être nettoyé dans le `return` du `useEffect` (politique Low-Memory).
- Stores zustand : `authStore`, `cacheStore`, `qualityUIStore`, `syncDownstreamStore`.
- Confirmations via un service global (`confirmService` + `GlobalConfirmModal`), et non via `window.confirm`.

---

## 8. Base de données locale SQLite

- Fichier par poste dans `%APPDATA%\gest-in-situ\...` (en dev : `%APPDATA%\gest-in-situ\dev\data\gest_in_situ.db`).
- **Tables** (déclarées dans `schema.ts`) : `t_sites`, `t_centres`, `t_postes`, `t_users`, `t_user_roles`, `t_cartes`, `t_cartes_fts` (FTS5), `t_anomalies_fts`, `t_logs`, `t_audit_log`, `audit_logs`, `t_outbox`, `t_sync_queue`, `t_import_anomalies` (file des lignes d'import rejetées), `t_import_temp`, `t_config` (préférences clé/valeur, ex. `auto_upstream_<id_user>`), `t_agent_archives`, ainsi que des tables transitoires de migration (`t_users_backup`, `audit_logs_new`).
- **Migrations** : fonction séquentielle de V2 à V70 dans `schema.ts`, basée sur `PRAGMA user_version`. Une installation neuve reçoit directement le schéma final.
- **FTS5** : `t_cartes_fts(noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)`, maintenue par des triggers (`trg_cartes_au`, etc.). Il existe une fonction `nuclearResetFts5()` dans `cartes.queries.ts`.
- **Côté Supabase** : `supabase/migrations/0001_baseline_schema.sql`, `0002_t_user_presence.sql`, `0003_apurement_correction_annulation.sql`, `0004_action_at.sql`, plus `supabase_schema.sql` (référence documentaire à la racine). Les migrations Supabase s'appliquent **manuellement** (SQL Editor), jamais automatiquement.
- **Volumétrie** : environ 220 700 cartes sur le site 4, d'après une copie de développement datée d'environ le 05/09/2026.

---

## 9. Moteur de synchronisation offline-first

### 9.1 Le « quadriptyque transactionnel » (règle obligatoire)
Toute mutation de carte doit, dans **une seule** `db.transaction()` :
1. modifier la ligne ;
2. poser `is_dirty = 1` ;
3. insérer une trace dans `t_logs` ;
4. enfiler un `enqueueOutbox(sync_id, table, operation, payloadComplet)` dans `t_outbox`. Le payload doit être la **carte entière relue**, sinon `mapCardPayload()` rejette l'entrée faute de `site_id`.

### 9.2 `t_outbox` (`src/main/sync/outbox.service.ts`)
- Colonnes : `id` (UUID, `INSERT OR IGNORE` pour l'idempotence), `table_name`, `operation` (`INSERT` / `UPDATE` / `DELETE`), `payload` (JSON), `status` (`PENDING` / `SYNCED` / `ERROR`), `attempts`, `depends_on`, `last_attempt_at`, `error_msg`.
- Lots de 50. Passage en `ERROR` après 5 tentatives, puis nouvelle tentative avec un backoff exponentiel de 15 min, plafonné à 24 h.
- **Envoi Automatique** (préférence `auto_upstream_<id_user>`) : ne conditionne que les entrées `t_cartes`. Il est désactivé par défaut pour `ADMINISTRATEUR_SITE`, pour protéger les imports massifs. Les mutations **unitaires** forcent l'envoi immédiat quel que soit ce réglage. `publishDrafts` le force jusqu'à 5 cartes, et reste soumis au réglage au-delà.
- Résolution de conflit : **Last-Write-Wins** sur `updated_at`.

### 9.3 Cycles (`src/main/sync/sync-engine.ts`)
- **Moniteur réseau** : ping toutes les 30 s. États `ONLINE` / `DEGRADED` / `PERMANENT_OFFLINE`. Après environ 3 échecs consécutifs, l'état passe à `PERMANENT_OFFLINE`, le moniteur **s'arrête définitivement** et seule une action utilisateur ou un redémarrage le relance (voir §16).
- **Upstream** : traitement de l'outbox (vidage immédiat si `ONLINE`), cycle périodique entre 5 et 30 min, gros volumes via `bulk-uploader` et `upload-worker`.
- **Downstream cartes** : cycle long de **2 h**, plus un cycle court de **75 s** qui commence par un simple `COUNT` Supabase. Un curseur (watermark) recule de 2 min par sécurité face aux horloges décalées. **Le téléchargement automatique est désactivé par défaut** sans préférence utilisateur : l'utilisateur doit cliquer sur « RÉCUPÉRER ».
- **Downstream comptes/rôles** : toutes les **3 min**, toujours actif, pour des raisons de sécurité (répercussion des révocations).
- **Logs downstream**, **synchro initiale** (`runSyncInitiale`), **resynchronisation complète** (admin de site ou super admin, contrôlée côté serveur).
- **Page de monitoring** : `/sync/status` (`SyncStatusDashboard`). Widget global `SyncWidget` dans la `TopBar`.

---

## 10. Authentification, session, licence, présence

- **Login local** : `authenticateUser()` (`users.queries.ts`) vérifie le hash bcrypt stocké dans `t_users`. Les comptes sont créés ou mis à jour depuis le cloud (`seedUserFromCloud`, `syncUsersFromCloud`, `preloadUsersFromCloud`). Le login fonctionne donc **hors ligne** une fois le compte rapatrié.
- **Contrôles au login** : site suspendu (`SITE_SUSPENDU`) ou licence expirée (`LICENCE_EXPIREE`), sauf pour le SUPER ADMIN et les sites `is_permanent`.
- **Session serveur** : `session-heartbeat.ts` conserve `secureCurrentUser` (rôle actif, site, centre) et le fournit via `getSecureCurrentUser()`. Tick toutes les 2 min : présence agent vers Supabase (fire-and-forget) et bannière d'expiration de licence (≤ 3 jours, réapparition toutes les 60 s pour un admin de site, toutes les 5 min pour les autres).
- **Fermeture à distance** : raisons `revoked`, `disabled`, `site_suspended`, `license_expired`, plus un message « compte connecté sur une autre machine ». *Le mécanisme exact de détection de la double connexion n'a pas été relu pour ce document.*
- **Présence** : table Supabase `t_user_presence`, page `/agents/presence`.
- **Mot de passe temporaire** : `resetAgentPassword()` ; modification du profil par l'utilisateur via `updateSelfProfile()`.

---

## 11. Import, export, doublons, recherche

- **Import** (`/import`, `import-worker.js` en worker thread, lots ≤ 500) : fichiers CSV. Les lignes invalides vont dans `t_import_anomalies` pour être traitées par la Qualité. Le format de `num_secu` (`^\d{13}$`, code `NUM_SECU_INVALIDE`) n'est validé que depuis le 05/09/2026.
- **Export** (Centrale d'Exportation `/export`, canaux `export:csv|excel|pdf|getRows|marquerExporte`, garde `assertExportAccess()`) : filtres par statut, anomalie et rangement, mode incrémental (`is_exported`). Le PDF sert de document d'émargement imprimable. `num_secu` est protégé contre la réinterprétation d'Excel dans les CSV.
- **Doublons** :
  - `cle_doublon = noms|prenoms|ddn|lieu_naissance|contact` (doublon **strict**) ;
  - `cle_doublon_flex = noms|prenoms|ddn|contact` (doublon **probable**).
  Pages Qualité dédiées. Une carte en doublon, en date invalide ou avec une identité vide **n'est pas envoyée au cloud** tant qu'elle n'est pas résolue. Un bouton « Forcer l'envoi malgré tout » existe (sauf pour les dates invalides).
- **Recherche** : plein texte FTS5, tolérante aux inversions nom/prénom et aux fautes de frappe (selon le README). Filtres complémentaires : date et lieu de naissance, pour départager les homonymes.

---

## 12. Tests, CI/CD, packaging, auto-update

- **Vitest** (`tests/*.test.ts`, 9 fichiers, majoritairement des tests RBAC et de synchronisation) : `export-rbac`, `hierarchy-delete-*`, `logs-purge-import-cleartemp-rbac`, `p1-forceglobal-sync-rbac`, `p1-sitessummary-clearlogs-configset-rbac`, `qualite-supprimer-incoherences-rbac`, `session-heartbeat-license-site`, `sync-workflow`.
- **Playwright e2e** (`e2e/specs/**`, 68 fichiers de spec) : chaque spec lance sa propre instance Electron isolée (`workers: 1`) avec une base pré-remplie (`e2e/fixtures/seed-*`). Dossiers : `adminsite`, `apurement`, `auth`, `cloud`, `import`, `loading-overlay`, `qualite`, `saisie`, `security`, `verification`, plus de nombreux specs `_agent13_*` écrits lors des tests terrain. Les specs `*.cloud.e2e.spec.ts` et `e2e/specs/cloud/` touchent un **vrai projet Supabase de dev/staging** (`.env.e2e`).
- **Validation obligatoire avant toute clôture de tâche** : `npx tsc --noEmit` avec 0 erreur. Le lint (`eslint src/`) existe.
- **Packaging** : `electron-builder.yml`, cible NSIS one-click en installation par utilisateur, avec un script NSIS personnalisé (`build/installer.nsh`) qui bloque le bouton [X] pendant l'installation. Pas de signature de code (`verifyUpdateCodeSignature: false`).
- **CI** : `.github/workflows/release.yml` se déclenche **uniquement** à la publication d'une Release GitHub. Il tourne sur `windows-latest` avec Node 20, lance `npm run release` et publie l'installeur. Il n'existe **aucune CI sur les push ou les pull requests** : ni `tsc`, ni tests, ni lint automatiques.
- **Auto-update** : `electron-updater` via GitHub Releases (`auto-updater.ts`). Une bannière `UpdateReadyBanner` s'affiche et l'installation a lieu à la fermeture de l'application.
- **Sauvegarde** : copie SQLite toutes les 24 h, 7 copies conservées.

---

## 13. Règles imposées à Claude Code (`CLAUDE.md`, résumé fidèle)

Toute suggestion de ta part **doit rester compatible** avec ces règles. Si une suggestion les remet en cause, dis-le explicitement et justifie-le.

1. **Jamais de build ou release à l'initiative de l'IA** (`build:win`, `release`) : uniquement sur instruction écrite de l'utilisateur.
2. **Low-Memory** (8 Go) : pas de boucle synchrone lourde. Chunks ≤ 500, `setTimeout` / `setImmediate` ou workers. Pas de gros tableaux gardés en mémoire. Nettoyage des listeners IPC.
3. **Cloisonnement site/centre** strict via `getSecureCurrentUser()` (§4 ci-dessus).
4. **STOP & WARN** : pour tout changement touchant un composant partagé, un utilitaire global, le schéma de base ou un handler IPC commun, l'IA s'arrête, signale le fichier et le module concernés, et attend l'accord de l'utilisateur.
5. **Git** : commit uniquement sur demande, avec vérification préalable de `git diff`. Il existe une autorisation durable pour la séquence commit → `release-notes.md` → push après un `tsc` à 0 erreur.
6. **Table de routage** des domaines vers les 14 agents (§14).
7. **Proposer la délégation** à l'agent adapté avant de travailler, et attendre un « oui ».
8. **Cycle de release différé** : `release-notes.md` sert de brouillon cumulatif. Le versioning SemVer, `CHANGELOG.md` et `SCHEMA_VERSION` ne sont traités qu'au moment du `build:win` : validation GO/NO-GO, release manager, commit, build, tag, puis publication manuelle de la Release par l'utilisateur.
9. **Vigilance post-implémentation** : proposer un audit de non-régression (agent-9) et un test UX terrain (agent-13).
10. **Résumé de la demande et validation explicite** avant toute action substantielle.
11. **Documentation des librairies externes via Context7** (MCP), pas de mémoire seule.
12. **Zéro affirmation non vérifiée** : chaque fait doit être rattaché à un `fichier:ligne` ou à une sortie d'outil. Distinguer le vérifié du supposé.

Gouvernance complémentaire (`docs/GOVERNANCE.md`) : projet classé **HEAVY** (PII, production, réversibilité difficile). Fichiers `PROJECT_STATE.md` et `TASKS.md` (actuellement **vides**, à l'état de gabarits). Audit agent-9 tous les 1 à 3 mois et avant chaque release. Les P0/P1 bloquent les nouvelles fonctionnalités, sauf dérogation. Des ADR sont prévus dans `docs/decisions/`, **dossier inexistant à ce jour**.

**Contrainte d'environnement importante** : `npm run dev` pointe sur une base SQLite contenant de **vraies données de production** **et** sur le **projet Supabase de production**. Aucun test en écriture n'est donc possible en dev sans isoler les données et basculer vers `.env.e2e`.

---

## 14. Écosystème Claude Code du dépôt (`.claude/`)

**14 agents** (`.claude/agents/*.md`) :
1. architect-pm (plan d'impact)
2. designer (UI/CSS)
3. coder (implémentation)
4. db-sync (schéma et synchro)
5. qa-optimisation (fuites mémoire et IPC)
6. qa-syntax (tsc)
7. release-master
8. icon-asset-master
9. senior-auditor (audit P0/P1/P2)
10. refactoring-speed-booster (performance et RAM)
11. release-manager (SemVer, CHANGELOG)
12. deploy-validator (GO/NO-GO)
13. qa-terrain-tester (test vivant par rôle)
14. debugger

**8 skills** (`.claude/skills/`) : `deploy-checklist`, `low-memory-patterns`, `modal-adaptatif-terrain`, `moteur-sync-offline-first`, `prompt-builder`, `rapport-p0-p1-p2`, `run-tests`, `semver-release-rules`. Des hooks existent aussi (`.claude/hooks/`).

Dans tes prompts, tu peux recommander un agent précis (exemple : « à confier à `agent-4-db-sync` »). C'est Claude Code, dans sa session principale, qui décidera de l'invoquer après validation de l'utilisateur.

---

## 15. Historique et état actuel

- **Premier commit** le 03/05/2026 (« Modernized Electron V2 Architecture »), après une V1 dont il reste des scripts de migration (`migrateV1_extract.ts`, `restructure_migrateV1.js`). Environ 311 commits depuis.
- **Cadence** : 34 versions entre la 2.1.0 (09/07/2026) et la 2.21.0 (04/09/2026), avec souvent plusieurs versions par semaine.
- **Style des commits** : Conventional Commits en français (`fix(export): …`, `chore(release-notes): …`), chaque correctif étant suivi d'une entrée dans `release-notes.md`.
- **Dernier commit** : `8b3a264` du 05/09/2026, qui ajoute la section « Travail du jour » au portail Qualité.
- **Brouillon non publié** (`release-notes.md`) : section « Travail du jour » de la Qualité, statut physique et centre visibles sur la fiche carte, correctifs de sécurité (transactions et cloisonnement par centre dans la File d'attente, contrôle d'accès sur `export:marquerExporte`), nombreux correctifs de la Centrale d'Export et de la page Cartes, validation de `num_secu` à l'import, export CSV/Excel non bloquant.
- **Fichier non commité** : `AUDIT_COMPLET_APPLICATION_2026-09-24.md`, un audit en lecture seule du 24/09. **Aucun de ses points 🔴 n'a été corrigé à ce jour.**

---

## 16. Problèmes connus et dette technique

### 16.1 Critiques (audit du 24/09/2026, non corrigés)

| # | Problème | Localisation | Statut de preuve |
|---|---|---|---|
| 🔴4 | **`num_secu` détruit** : 78 090 cartes sur 220 693 (35,4 %) portent un numéro en notation scientifique `3,84E+12` (il ne reste que 3 chiffres sur 13, sans récupération possible depuis la base). 81 718 cartes (37 %) n'ont aucun numéro. Au total, **72,7 % des cartes sont inexploitables** sur ce champ. L'origine est dans les fichiers Excel sources, antérieurs au contrôle d'import du 05/09. Ces valeurs sont **déjà synchronisées dans le cloud**. Trois voies d'écriture n'ont toujours aucun contrôle : `createCarte`, `updateQuickFields`, `updateRangementEtFiche`. Au mieux ~9 % des cartes sont récupérables depuis les fichiers retrouvés. | `import-worker.js`, `cartes.queries.ts` | Mesuré sur une copie de dev (≈ 05/09), pas sur la base de production ni sur Supabase |
| 🔴1 | **Perte silencieuse côté Logistique et Qualité** : `autoEnqueueCorrection` (`cartes.queries.ts:21-58`) n'enfile rien quand la carte est en doublon, a une date invalide, une identité vide ou pas de `sync_id`. La carte reste `is_dirty=1` sans entrée dans l'outbox, **aucun balayage ne la rattrape**, et l'UI affiche « succès ». `enqueueSyncOp` n'a aucun appelant. | `cartes.queries.ts`, `sync.queries.ts:7` | Relu dans le code ; lien avec l'incident signalé par la direction non prouvé |
| 🔴3 | **`delivrerCarte` sans garde `DELIVRE`** : une seconde délivrance écraserait le retirant et la preuve. La protection n'existe que côté UI. | `cartes.queries.ts:656-687` | Relu ; non reproduit en exécution |
| 🔴2 | **Correction de la date de naissance par la Qualité** écrite sans normalisation ISO (un `JJ/MM/AAAA` serait stocké brut). | `handlers.ts:2675,2740`, `cartes.queries.ts:1640-1716` | Relu côté serveur ; non reproduit |
| P0 | **Index FTS5 corrompu** (`integrity-check` → « database disk image is malformed ») constaté dans le build `dist-e2e-cloud`. Il bloque les corrections des champs indexés. | `schema.ts` (triggers FTS) | **Non vérifié sur la base de production** |

### 16.2 Importants (🟠)
- **Blocage réseau `PERMANENT_OFFLINE` en pleine session** : trois pings ratés (~90 s) suffisent. Le moniteur s'arrête alors pour de bon et plus rien ne se synchronise sans clic sur « Réessayer », envoi manuel ou redémarrage. L'indication à l'écran reste discrète. (`network-monitor.ts:31,160-179,249`, `sync-engine.ts:730-742`)
- **Téléchargement automatique désactivé par défaut** : un autre poste ne voit rien sans clic sur « RÉCUPÉRER ».
- **`getDetailedSyncStats` prend 25 à 36 s par appel** et est rappelée en boucle sur le poste concerné (worker de statistiques à file unique).
- **Boucle de récupération cloud** : le recul de 2 min du curseur fait recompter indéfiniment la même fenêtre.
- **Import** : `.xlsx`/`.xls` proposés mais lus comme du texte (import de données illisibles avec un toast « succès »). Aucune validation des en-têtes. Alias de colonnes différents entre l'aperçu et le worker. Parsing CSV naïf (`split` sans gestion des guillemets). « Migration terminée ! » s'affiche même avec 100 % de rejets. `import:parseCSV` et `import:selectFile` n'ont pas de `verifyUserRole`.
- **Incohérences de validation** : 4 définitions différentes de l'« identité minimale ». `updateCarte` (branche anomalie) n'a ni validation ni cantonnement par centre pour `ADMIN_CENTRE`, avec un repli `siteId || 1`. `deleteCarte` est trop permissif. `updateQuickFields` modifie `contact` sans recalculer `cle_doublon`.
- **Handlers enregistrés sans contrôle de rôle** mais non exposés au preload (donc latents) : `cmu:*`, `retrait:*`, `queue:*`, `admin:*`, `apurement:*`. 23 handlers n'ont pas d'entrée preload, et 6 méthodes preload n'ont pas de handler.
- **Environ 40 `catch` qui ne font que `console.error`**, plus des catch vides : un échec est indiscernable d'une absence de données.
- **Libellés de synchronisation incohérents** entre les portails.
- **`ADMIN_CENTRE` voit l'onglet Apurement** alors que le serveur lui refuse les canaux correspondants.
- Le **`sync_id` du site « PLATEAU »** doit être vérifié côté Supabase (risque de doublon de site).
- Demande métier en attente : **ajouter le champ `contact` au formulaire de rangement** de la Logistique (plan détaillé dans l'audit, §2).

### 16.3 Dette structurelle observée (constats de Claude Code pour ce document)
- **Fichiers monolithiques** : `handlers.ts` (~7 400 lignes, 214 handlers), `schema.ts` (~3 900 lignes), `cartes.queries.ts` (~2 900), `stats.queries.ts` (~1 500), `import-worker.js` (~1 500).
- **Workers en JavaScript non typé** (`src/main/workers/*.js`), avec une logique dupliquée depuis le TypeScript (exemple : `isValidDateStrict` copiée dans `upload-worker.js`).
- **Pas de CI** sur push ou PR.
- **Couverture de tests unitaires faible** sur la logique métier : 9 fichiers, surtout RBAC. En pratique, la validation repose sur les e2e et sur les tests terrain de l'agent-13.
- **Pas d'environnement dev isolé** par défaut (le dev pointe sur les données et le Supabase de production).
- **Racine du dépôt encombrée et versionnée** : `git ls-files` montre des journaux, dumps et scripts ad hoc suivis par Git (`console.txt` ~1,1 Mo, `debug_ignore.txt` ~2,8 Mo, `diff.txt`, `gest-in-situ-diagnostic.log`, `handle_lines.txt`, `tsc_output.*`, `scratch/*`, 10 copies `electron.vite.config.<timestamp>.mjs` pourtant listées dans `.gitignore`, `MEMO_DRIVE_SUPER_ADMIN.txt`, `forge.config.cjs`, `installer.iss` hérités). *Leur contenu n'a pas été relu pour ce document. Le dépôt GitHub étant référencé comme `homepage`, il faut vérifier sa visibilité et l'absence de données personnelles ou de secrets dans ces fichiers.*
- Rôle `CONSULTANT` et `main/updater.ts` morts. `getDoublonsProbablesPage_UNUSED_KEEP` conservée « pour référence ».
- Pas de signature de code de l'installeur Windows (SmartScreen, intégrité de l'auto-update).
- `sandbox: false` sur la fenêtre principale (atténué par `contextIsolation: true` et `nodeIntegration: false`).

---

## 17. Ce que l'on attend de toi

### 17.1 Ton avis
Donne un **avis global honnête et argumenté** sur :
1. l'architecture (offline-first, outbox, LWW, IPC centralisé) ;
2. la fiabilité des données et de la synchronisation ;
3. la sécurité (RBAC, cloisonnement, PII, packaging) ;
4. la qualité du code et la dette ;
5. la stratégie de tests et de CI ;
6. l'ergonomie terrain ;
7. la gouvernance du développement assisté par IA (CLAUDE.md, agents).

Signale ce qui est **bien fait** autant que ce qui pose problème. Hiérarchise : **P0** (perte de données, sécurité, blocage terrain), **P1** (important), **P2** (amélioration).

### 17.2 Contraintes à respecter dans tes suggestions
- L'application est **en production**. Privilégie les changements **incrémentaux, réversibles et testables**. Pas de réécriture complète.
- Respecte la **politique Low-Memory** (8 Go, lots ≤ 500) et le **cloisonnement site/centre**.
- Toute modification de schéma passe par une **migration numérotée** dans `schema.ts` (SCHEMA_VERSION + 1), avec une migration Supabase équivalente appliquée manuellement.
- Toute réparation de données de masse doit être **mesurée d'abord en lecture seule sur la production**, puis exécutée en lots asynchrones, synchronisée via l'outbox et **validée par l'utilisateur**.
- Aucune suggestion ne doit demander à Claude Code de lancer un build ou une release, ni d'écrire sur la base de dev (données réelles et Supabase de production).
- Si tu n'es pas sûr d'un point parce que ce document ne le couvre pas, **dis-le** et formule ton prompt pour que Claude Code **vérifie d'abord** dans le code avant d'agir.

### 17.3 Format obligatoire de chaque suggestion

Pour **chaque** suggestion, produis ce bloc (en français) :

````markdown
### [P0|P1|P2] Titre court de la suggestion

**Constat :** ce que tu as relevé dans ce document (cite la section).
**Pourquoi c'est important :** impact métier ou technique concret.
**Risque du changement :** ce qui pourrait régresser.
**Agent recommandé :** agent-X-… (voir §14), ou « session principale ».

**Prompt pour Claude Code :**
```
Contexte : GEST-IN-SITU (voir docs/PROJET_CONTEXTE_COMPLET_POUR_IA.md §…).
Objectif : …
Étape 1 — Vérification préalable (lecture seule) : lire <fichiers/fonctions>, confirmer que <constat> est toujours vrai ; si ce n'est plus le cas, s'arrêter et me le signaler.
Étape 2 — Plan : proposer le correctif minimal, lister les fichiers touchés, signaler tout composant partagé (STOP & WARN, CLAUDE.md §4) et attendre ma validation.
Étape 3 — Implémentation : …
Contraintes : Low-Memory (lots ≤ 500), cloisonnement via getSecureCurrentUser(), quadriptyque transactionnel pour toute mutation de t_cartes, aucune écriture sur la base de dev, aucun build.
Validation : npx tsc --noEmit (0 erreur) + <test Vitest/Playwright ciblé à créer ou lancer> + critère d'acceptation observable : …
```
````

### 17.4 Ordre de restitution souhaité
1. Avis global (une demi-page maximum).
2. Tableau récapitulatif de toutes tes suggestions (priorité, titre, effort estimé S/M/L, agent).
3. Les blocs détaillés du §17.3, **du plus prioritaire au moins prioritaire**.
4. Les questions ouvertes éventuelles, formulées comme **vérifications à confier à Claude Code** et non comme questions au propriétaire.
