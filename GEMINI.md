# GEST-IN-SITU - Documentation Contexte pour Modèles IA (GEMINI.md)

Ce document fournit une vue d'ensemble technique, architecturale et opérationnelle du projet **GEST-IN-SITU**. Il est conçu pour servir de mémoire de contexte à tout futur modèle d'IA devant intervenir sur cette base de code.

---

## 1. Description du Projet
**GEST-IN-SITU** est une application desktop offline-first conçue pour gérer la saisie, le stockage, le classement logistique, l'inventaire physique, le suivi des retraits et la distribution des **cartes CMU (Caisse Nationale d'Assurance Maladie)** dans des centres locaux (ex: Abobo, etc.).

L'application fonctionne principalement hors-ligne pour faire face aux contraintes de connectivité du terrain, en persistant ses données dans une base **SQLite locale**. Elle intègre un moteur de synchronisation asynchrone bidirectionnel automatique et résilient connecté à une base de données cloud **Supabase (PostgreSQL)**.

---

## 2. Technologies Utilisées
*   **Framework Desktop :** Electron (vitesse et intégration Windows native via `electron-vite`).
*   **Frontend :** React + TypeScript (Vanilla CSS, style premium sous la thématique lumineuse "Plein Soleil" - verres de translucidité et micro-animations).
*   **Base de Données Locale :** SQLite via `better-sqlite3` (configuré en mode WAL pour une concurrence d'écriture performante et non bloquante).
*   **Recherche Plein Texte locale :** Moteur SQLite FTS5 (indexation instantanée des cartes sur le nom, prénom, numéro de sécu, etc.).
*   **Synchronisation Cloud :** Supabase (PostgreSQL + PostgREST) avec authentification JWT native Supabase Auth.
*   **Validation et Typage :** TypeScript Strict.
*   **Packaging Windows :** Inno Setup compiler (`compile_installer.ps1` + `installer.iss`).

---

## 3. Structure des Fichiers Clés
```files
src/
├── main/                       # Processus principal (Main Process Electron)
│   ├── auth/                   # Authentification et gestion de session locale
│   ├── database/               # Initialisation SQLite, WAL, FTS5 et Migrations
│   │   ├── connection.ts       # Démarrage de la base, compactage VACUUM & corrections
│   │   ├── schema.ts           # Définition des schémas et tables SQLite
│   │   └── queries/            # Requêtes CRUD locales (hierarchy, cartes, users, logs)
│   ├── ipc/
│   │   └── handlers.ts         # Canaux de communication IPC (Renderer ↔ Main)
│   ├── sync/                   # Moteur de Synchronisation Offline-First
│   │   ├── network-monitor.ts  # Détecteur d'état réseau local (ONLINE/OFFLINE)
│   │   ├── outbox.service.ts   # Queue transactionnelle montante (t_outbox)
│   │   ├── upstream.ts         # Envoi par lots (upserts) vers Supabase
│   │   ├── downstream.ts       # Téléchargement asynchrone des cartes par tranches
│   │   └── sync-engine.ts      # Planificateur à backoff exponentiel (5 min à 30 min)
│   ├── workers/                # Workers threads pour l'import de gros volumes CSV
│   └── index.ts                # Point d'entrée Electron (Single Instance Lock)
├── preload/                    # Script de préchargement (Sécurité contextBridge)
│   ├── global.d.ts             # Typages TypeScript des APIs exposées
│   └── index.ts                # Exposition sélective des API SQLite & Supabase
├── renderer/                   # Interface Utilisateur (Renderer Process React)
│   └── src/
│       ├── App.tsx             # Routage React Router & Gestion des permissions
│       ├── stores/             # Gestion globale d'état (Zustand)
│       ├── components/         # Composants communs (Sidebar, TopBar, modales globales)
│       └── pages/              # Pages applicatives (Dashboard, Cartes, Saisie, Qualité, etc.)
│           └── SyncStatusDashboard.tsx # Monitoring de synchronisation en temps réel
└── shared/                     # Utilitaires partagés (normalisation des dates, etc.)
```

---

## 4. Fonctionnalités Implémentées

### A. Authentification & Sécurité
*   **Cycle d'Authentification :** Authentification locale sécurisée via hash bcrypt de mot de passe et synchronisation avec Supabase Auth (UUID généré comme `sync_id`).
*   **Single Instance Lock :** Utilisation de `app.requestSingleInstanceLock()` pour interdire les lancements multiples de l'application et protéger la base SQLite locale.
*   **Vérification Administrateur :** Modale de confirmation sécurisée (`GlobalConfirmModal`) requérant la validation asynchrone du mot de passe maître pour les actions destructrices ou critiques (ex: purges).

### B. Moteur de Synchronisation Résilient (Offline-First)
*   **Outbox Pattern (`t_outbox`) :** Toute opération de création ou mise à jour locale sur les Sites/Centres/Utilisateurs dépose une transaction dans `t_outbox`. La file d'attente traite ces requêtes de façon séquentielle et idempotente (via UUID `sync_id`) uniquement lorsque la connexion Supabase est établie.
*   **Algorithme de Backoff Exponentiel :** Pour préserver la bande passante et éviter les saturations, le cycle automatique de synchro s'exécute par défaut toutes les **5 minutes** en mode idle, et double (jusqu'à **30 minutes**) à chaque itération vide (0 ligne traitée), pour se réinitialiser immédiatement à 5 minutes au premier élément synchronisé.
*   **Downstream intelligent :** Téléchargement asynchrone des cartes par blocs avec yield de la boucle d'événements, filtré dynamiquement par le `site_id` de l'administrateur connecté.

### C. Gestion des Cartes (CRUD & FTS5)
*   **Saisie & Validation :** Détection préventive et blocage des doublons stricts et incohérences.
*   **Recherche FTS5 :** Recherche floue instantanée sur le thread d'interface sans latence de base de données.
*   **Liaison Forcée de `sync_id` :** Génération forcée d'UUIDs locaux et réconciliation automatique au démarrage (`ensureSyncIds`) pour garantir qu'aucune carte, centre ou site ne transite sans clé d'idempotence.

### D. Monitoring en Temps Réel
*   **Dashboard de Synchronisation :** Outil de suivi affichant l'état du réseau (ONLINE/OFFLINE), le volume de la file d'attente d'importation, le volume de l'Outbox montante, et les 5 dernières erreurs extraites de la table `t_logs`.
*   **Purge et Maintenance Asynchrones :** Exécution asynchrone des opérations lourdes (Vacuum, sauvegarde db.backup SQLite) pour ne jamais geler le thread principal d'affichage.

---

## 5. Décisions Importantes de Conception

1.  **Strict Isolation (Bypass direct vers Supabase interdit) :**
    Toute modification locale doit passer par l'API locale des queries SQLite, qui enregistre en base et dépose en Outbox. Éviter d'effectuer des requêtes `supabase.from().insert/update` directes depuis le Renderer pour garantir l'offline-first.
2.  **Pas de `npm run build` non sollicité :**
    Pour valider la conformité du code et du typage strict TypeScript sans casser le cache ou la structure compilée, utilisez exclusivement la commande :
    ```bash
    npx tsc --noEmit
    ```
3.  **Liaisons UUID `sync_id` :**
    La synchronisation de toutes les entités de l'infrastructure (`t_sites`, `t_centres`, `t_postes`, `t_users`) repose sur un `sync_id` UUID v4 partagé. L'ID auto-incrémenté SQLite local sert uniquement aux relations et index locaux.
4.  **Mappage des Colonnes SQLite ↔ Supabase :**
    Attention aux légères variations de schémas (ex: `site_id` en SQLite local correspond à `id_site` dans la table distante Supabase `t_cartes`). Toujours vérifier [upstream.ts](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/src/main/sync/upstream.ts) pour les conversions.

---

## 6. Instructions pour un Futur Modèle d'IA
*   **Respecter les Transactions :** Lors d'opérations d'écriture multiples sous `better-sqlite3`, utilisez le wrapper transactionnel correct :
    ```typescript
    const tx = db.transaction(() => { /* requêtes */ });
    tx();
    ```
*   **Ne jamais figer le Main Thread :** Envelopper les opérations de fichiers volumineuses, les sauvegardes SQLite (`db.backup()`) ou les transactions lourdes dans des blocs `setImmediate` ou des promesses asynchrones.
*   **Vérifier le Typage :** Mettre systématiquement à jour [preload/global.d.ts](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/src/preload/global.d.ts) pour toute nouvelle fonction IPC enregistrée dans `handlers.ts` avant de l'exploiter dans le code React.
*   **Conservation des logs :** La table `t_logs` est l'organe central d'audit et de monitoring. Journaliser soigneusement les événements avec `logAudit` (en local) et loguer via `electron-log`.

---

## 7. Format de Communication & de Prompt pour l'IA
Chaque fois qu'un modèle d'IA intervient ou formule des réponses/prompts intermédiaires pour l'utilisateur, il doit respecter la structure suivante :

1.  **Synthèse Concise d'Analyse :** Présenter les causes racines trouvées après investigation (erreur de schéma, type TS, lock, etc.).
2.  **Plan de Modifications Ciblées :** Donner la liste exacte des fichiers à modifier avec un extrait des lignes concernées.
3.  **Validation Statique & Exécution :** Rappeler qu'aucune commande `npm run build` ne doit être exécutée, mais uniquement `npx tsc --noEmit`.
4.  **Clickable Links :** Utiliser systématiquement des liens cliquables respectant le format standard markdown avec le protocole `file://` pour tous les fichiers modifiés ou analysés (ex: `[handlers.ts](file:///d:/Espace%20travail/GEST_IN-SITU_CARTE_ABOBO_V2/src/main/ipc/handlers.ts)`).

Le format de prompt standard de production pour assigner une tâche de debug/développement à un agent ou pour l'utilisateur doit suivre ce schéma type :

```markdown
[CONSIGNE IMPÉRATIVE DE PRODUCTION]
- URGENT : [Décrire le problème ou l'erreur spécifique, ex: Échec de la purge cloud. Supabase indique que 'site_id' n'existe pas dans 't_cartes'.]
- OBJECTIF : [Définir l'objectif clair, ex: Aligner le schéma Supabase avec le schéma local ou corriger la requête.]
- PAS DE 'npm run build'. Utilise uniquement 'npx tsc --noEmit'.

[TÂCHES A ACCOMPLIR PAR L'AGENT 3]

1. [Détailler la tâche 1 de diagnostic/analyse]
   - [Sous-tâche 1.1]
   - [Sous-tâche 1.2]

2. [Détailler la tâche 2 de correction]
   - [Sous-tâche 2.1]
   - [Sous-tâche 2.2]

3. [Détailler la tâche 3 de vérification de cohérence]

[VALIDATION]
- Exécute 'npx tsc --noEmit'.
- [Détailler la condition de succès attendue, ex: Après modification, relancer la fonction. Le log doit indiquer "[SUCCÈS] ..."]
```

