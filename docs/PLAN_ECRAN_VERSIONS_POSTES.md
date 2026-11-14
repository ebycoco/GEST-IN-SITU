# Plan — écran « Versions des postes » (SUPER ADMIN)

Plan d'agent-1-architect-pm du 2026-11-14, validé par l'utilisateur le 2026-11-14 avec les choix
recommandés : migration **0010** (les fichiers non écrits du chantier B sont décalés en 0011+),
**dernier utilisateur exposé** dans la lecture, **accord STOP & WARN** pour des ajouts (sans
modification de l'existant) dans les fichiers partagés listés à l'étape 2 à 4.

## But
Connecté en SUPER ADMIN, voir dans l'application, sans passer par Supabase, la version de chaque
poste installé, son site, la dernière remontée, le dernier utilisateur connu, et s'il est à jour
par rapport à la dernière version publiée. Ne fonctionne qu'à partir de la version qui embarque
ce changement (la 2.26.2 n'envoie rien).

## Existant (vérifié)
- 0009 en prod : `t_client_versions` (illisible anon/authenticated) et RPC
  `fn_report_client_version` (SECURITY DEFINER, **fermée** jusqu'à ouverture).
- `presence:getAgents` (`src/main/ipc/handlers.ts:485-511`) : modèle de contrôle d'accès
  (`getSecureCurrentUser()` + `verifyUserRole()`).
- `electron-builder.yml` : `perMachine: false` (l.29), `deleteAppDataOnUninstall: false` (l.32).
- Auto-updater (`src/main/auto-updater.ts`) : `UpdateInfo.version` disponible dans
  `update-available` / `update-not-available`.

## Choix
1. **Identifiant de poste** : UUID (`crypto.randomUUID()`) créé au premier lancement, stocké dans
   `userData/gis-poste/poste-id.json` (écriture atomique temporaire + rename ; illisible → régénéré
   et journalisé). Pas dans `t_config` (une base restaurée ou copiée dupliquerait la clé). Pas de
   nom de PC (donnée personnelle possible) : affichage « Poste » + 8 premiers caractères.
2. **Envoi** (`src/main/sync/client-version.service.ts`) : tâche de fond, jamais attendue, erreurs
   absorbées. Démarrage + ~20 s (timer `unref`) si ONLINE, sinon un essai au premier retour en ligne ;
   après connexion réussie (avec `sync_id` de l'utilisateur et `t_sites.sync_id` local, jamais les id
   locaux) ; au plus 1 envoi/heure/processus sauf changement d'utilisateur ou de version ; **rien
   en `is.dev`** sauf `GIS_REPORT_VERSION_IN_DEV=1` ; rien si client Supabase absent.
3. **Lecture** : nouvelle RPC `fn_list_client_versions()` (0010) SECURITY DEFINER, STABLE,
   search_path figé, `LIMIT 1000`, EXECUTE anon/authenticated. Renvoie `poste_ref = left(poste_key, 8)`
   (jamais la clé complète), `app_version`, `site_sync_id`, `last_user_sync_id`, `first_seen_at`,
   `last_seen_at`, `nb_reports`, `key_kind`. Écarte `preuve-%` et les lignes sans site valide ni
   utilisateur connu (compteur « lignes ignorées »). Aucun nom : traduction sync_id → site/login en
   local côté main. **À refermer en P2** (contrôle `fn_jwt_is_super_admin()` + REVOKE anon) : à
   inscrire dans le brouillon P3. Option « preuve par mot de passe SA en SQL » écartée (essais sans
   limite).
4. **Écran** : route `postes/versions` (`App.tsx`, `requiredRoles={['SUPER ADMIN']}`), entrée
   « Versions des postes » dans les deux menus SA de `Sidebar.tsx`. Tableau : poste, site, version,
   état (à jour / en retard / inconnu / silencieux > 7 j), dernière remontée, dernier utilisateur
   connu, première vue, classe de clé. Synthèse en tête, filtres site/état, bandeau expliquant que
   seuls les postes ≥ la version qui embarque la fonction se déclarent. Version de référence :
   `getLastKnownLatestVersion()` de l'auto-updater, sinon plus haute version vue. Hors ligne :
   message « Connexion Internet requise ». Bouton Actualiser, pas d'actualisation automatique.
   Alerte si le nombre de lignes dépasse ~200 (plafond 5000 de 0009).
5. **Accès** : handler `versions:getPostes`, refus si pas de session, rôle actif ≠ SUPER ADMIN ou
   `verifyUserRole` faux ; journal `[SECURITY]` ; aucun paramètre du renderer.

## Étapes
1. **0010 lecture** (agent-4) : `supabase/migrations/0010_lecture_versions_postes.sql` + test
   (transaction annulée) ; README des migrations ; `docs/PLAN_P1_CHANTIER_B.md` (renumérotation
   0011+ et REVOKE à prévoir au brouillon P3). Appliquée sur le **dev** seulement.
   **FAIT sur le dev le 2026-11-14 (agent-4, non commité)** : forme retenue = liste
   `fn_list_client_versions()` (RETURNS TABLE, colonnes du choix 3) + petite fonction
   `fn_count_client_versions()` (une ligne toujours : `nb_total`, `nb_preuve`, `nb_ignorees`,
   `nb_listables` ; `nb_listables` > 1000 = liste tronquée), pour garder les compteurs même quand
   toutes les lignes sont écartées. Une ligne est gardée si son site **ou** son dernier
   utilisateur est reconnu. Test 0010 **14/14** ; tests 0009 17/17, 0008 26/26, 0007 20/20,
   0006 19/19 rejoués (transactions annulées). REST réel clé publishable du dev : liste 200
   (2 postes visibles, `poste_ref` sur 8 caractères), comptage 200 (4 / 1 / 1 / 2), table
   directe 401 (42501), `fn_report_client_version` 401 (toujours fermée). Lignes de test
   supprimées (0 restante). Prod : non appliquée (étape 6, procédure dans
   `supabase/migrations/README.md`). Pour l'étape 3 : appeler les deux RPC sans paramètre
   (POST `/rest/v1/rpc/fn_list_client_versions` et `/rpc/fn_count_client_versions`).
2. **Envoi** (agent-3) : `client-version.service.ts` ; ajouts dans `src/main/index.ts` et
   `src/main/ipc/handlers.ts` (~l.290 et ~l.300).
   **FAIT le 2026-11-14 (agent-3, non commité)** : clé UUID dans `userData/gis-poste/poste-id.json`
   (écriture temporaire + rename, fichier invalide → régénéré), envoi `void` au démarrage + 20 s
   (timer unref) et après chaque connexion réussie (chemins ROOT et normal, juste après
   `startSessionHeartbeat`), un seul écouteur réseau armé si hors ligne, 1 envoi/h sauf changement
   d'utilisateur ou de version, identité relue dans `getSecureCurrentUser()` (sync_id utilisateur +
   `t_sites.sync_id`), rien si `!app.isPackaged` (= `is.dev`) sauf `GIS_REPORT_VERSION_IN_DEV=1`,
   erreur « permission denied » journalisée en info ; arrêt dans `will-quit`.
   **Corrections P2 de l'audit faites, non commitées (2026-11-14)** : envoi récurrent toutes les 12 h
   (1 `setInterval` unref), lecture de clé tolérante (nouvel essai 200 ms, jamais d'écrasement sur
   erreur non-ENOENT), connexion pendant un envoi rejouée une fois, message dev avec avertissement PROD.
3. **Lecture + handler** (agent-3) : `listClientVersions()`, canal `versions:getPostes`, getter
   dans `auto-updater.ts`, `preload/index.ts`, `preload/global.d.ts`, type dans `shared/types.ts`.
   **FAIT le 2026-11-14 (agent-3, non commité)** : `listClientVersions()` (2 RPC, timeout 15 s,
   traduction locale site/login), handler `versions:getPostes` (session + rôle actif SA +
   `verifyUserRole`, `[SECURITY]`, réponse `{ success:false, error: 'FORBIDDEN' | 'OFFLINE' |
   'NO_CLIENT' | 'TIMEOUT' | 'RPC_ERROR' | 'INTERNAL' }`), `getLastKnownLatestVersion()`,
   `window.api.versions.getPostes()`, types `PosteVersionRow` / `PostesVersionsCounts` /
   `PostesVersionsResult`. Tests `tests/client-version-service.test.ts` (21) et
   `tests/versions-getpostes-rbac.test.ts` (4) ; `tsc` 0 erreur.
   **Corrections P2 de l'audit faites, non commitées (2026-11-14)** : code `LOCAL_ERROR` (erreur
   SQLite locale, type `PostesVersionsError`) ; tests portés à 34 + 5 (succès du handler, démarrage/
   12 h/arrêt, TIMEOUT, clé EBUSY/ENOENT, rejeu de connexion) ; suite complète 1044/1044.
4. **Écran** (agent-2) : `PostesVersionsPage.tsx`, `postesVersionsStatus.ts`, route et menu.
   **FAIT le 2026-11-14 (agent-2, non commité)** : page + logique pure dans `src/renderer/src/pages/`,
   route `postes/versions` (SUPER ADMIN) dans `App.tsx`, entrée « Versions des postes » dans les deux
   menus SA de `Sidebar.tsx`, tests `tests/postes-versions-status.test.ts` (18). Rendu réel non vérifié visuellement.
5. **Tests** : Vitest (comparaison de versions, statuts, clé de poste, refus du handler pour non-SA
   et rôle actif non SA), `tsc`, e2e cloud sur le **dev** uniquement, e2e hors ligne ; audit agent-9
   (Opus) ; test terrain agent-13.
6. **Gestes utilisateur** : appliquer 0010 en prod (fonctions `fn_list_client_versions` et
   `fn_count_client_versions`) ; juste avant la Release,
   `GRANT EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;`
   (rejouer 0009 la referme) ; release selon CLAUDE.md §8 ; inventaire manuel des postes absents.

## Risques suivis
Démarrage ralenti (aucun await sur le chemin), synchro perturbée (aucun lien outbox), hors ligne,
postes non SA, pollution de la prod par le dev (garde `is.dev`), fuite par la RPC anon (clé
tronquée, pas de nom, LIMIT), plafond 5000, clé dupliquée par copie de `userData`.
