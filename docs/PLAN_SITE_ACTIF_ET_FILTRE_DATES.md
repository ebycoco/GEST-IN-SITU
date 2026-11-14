# Plan d'implémentation étanche — Site actif périmé (D1, D2) et filtre « Dates invalides » (D3)

Statut : PLAN (aucun code écrit). Auteur : agent-1-architect-pm, 2026-11-14.
Légende : **[lu]** = vérifié par lecture de fichier:ligne dans cette session ; **[supposé]** = inférence non vérifiée (à confirmer par agent-13 ou test).

---

## 0. Synthèse

| Défaut | Cause racine (lue) | Correctif recommandé | Zone | Risque |
|---|---|---|---|---|
| D1 Dashboard | Cache `dashboardCache` non indexé par site, restauré dès que `cachedAt` existe | Étiqueter le cache avec une clé de portée (`scopeKey`), ne restaurer que si elle correspond, garde anti-réponse périmée | renderer (hook partagé + store partagé) | Moyen (hook très utilisé) |
| D2 Import | `importCache` lu au montage seulement (`[]`), non indexé par site | Même convention de clé de portée + effet réactif à `activeSiteId` | renderer (ImportPage + store) | Faible |
| D3 Dates invalides | Le handler IPC déclare 3 paramètres, ignore le 4e (`query`) | Ajouter `query` au handler et le transmettre à la requête (qui le gère déjà) | main (1 handler) | Très faible |

Constat important sur D3 : la fonction SQL `getInvalidDateRecords(siteId, offset, limit, query)` **accepte déjà `query`** et l'applique au COUNT comme à la page (`src/main/database/queries/cartes.queries.ts:1572-1637`) [lu]. Le preload et `global.d.ts` exposent déjà le 4e paramètre (`src/preload/index.ts:140-141`, `src/preload/global.d.ts:86`) [lu]. Le défaut tient donc à une seule ligne de signature + un argument dans `handlers.ts:1829/1837`. Pas de SQL, pas de schéma, pas d'index, pas de changement de contrat preload.

---

## 1. Défaut par défaut

### D1 — Tableau de bord : site actif non reflété (SUPER ADMIN)

**Cause racine confirmée [lu]**
- `src/renderer/src/pages/dashboard/hooks/useDashboardStats.ts:329-360` : l'effet `[activeSiteId, isGovernanceView]` lit `useCacheStore.getState().dashboardCache` ; si `cache.cachedAt` est truthy, il restaure TOUS les états (stats, saisies, cloud count, etc., l.333-346) et `hasCache = true` ; `loadStats()` / `loadGlobalData()` ne sont appelés que sans cache (l.353-359).
- `src/renderer/src/stores/cacheStore.ts:4-18,61-75` : `dashboardCache` ne porte AUCUN identifiant de site ; `setDashboardCache` (l.106-108) estampille `cachedAt = Date.now()` à chaque écriture, y compris les écritures partielles asynchrones.
- `src/renderer/src/stores/authStore.ts:95-97` : `setActiveSiteId` ne touche pas au cache. Les seuls invalidateurs sont `ImportPage.tsx:220,273` (`invalidateDashboardCache`) et le logout (`authStore.ts:83-84`, `clearCache`) [lu].
- Le composant `DashboardPage` (`src/renderer/src/pages/dashboard/index.tsx:9-43`) reste monté lors d'un changement de site, donc le hook garde aussi ses `useState` propres : `totalCloudCartesCount` (alimenté uniquement l.175-180, jamais restauré depuis le cache) et `centreCardsCount` restent sur la valeur du site précédent tant qu'aucun `loadStats` ne passe [lu].
- Explication du « 0 puis 23 puis 23 » [supposé, cohérent avec le code] : la vue gouvernance (SUPER ADMIN sans site actif) écrit `dashboardCache` via `loadGlobalData` (l.76-79) avec `stats` resté `null` et `cachedAt` renseigné ; le passage au site A restaure donc `stats = null` (affiché 0, car `SiteAdminView.tsx:600` n'affiche le squelette que si `!stats`), puis B charge et écrit 23 dans le cache, puis le retour sur A restaure le cache de B (23). « Actualiser » appelle `loadStats` directement, d'où la bonne valeur.
- Aggravant lu : aucune garde de péremption dans `loadStats`. Une réponse tardive du site A peut appeler `setStats` (l.144) / `setDashboardCache` (l.125-128, 166-169, 196-205) après bascule sur B, et la mise à jour partielle `{...dashboardCache, cloudCartesCount}` re-estampille `cachedAt` sur un cache d'un autre site. Même défaut sur le tick toutes les 3 minutes (l.237-249) et l'abonnement `onCardsReceived` (l.287-327, celui-ci a déjà une garde de site à l.292-297, bien).

**Solution recommandée : cache étiqueté par portée (« scope key ») + garde de péremption**
1. `cacheStore.ts` : ajouter à `dashboardCache` un champ optionnel `scopeKey?: string | null` (champ optionnel = aucune rupture de forme ; `clearCache` l.133-136 le remet à `null`). Valeurs : `'GLOBAL'` pour la vue gouvernance, `'SITE:<id>'` sinon (éventuellement suffixé par rôle/centre, voir Q2).
2. `useDashboardStats.ts` :
   - calculer `scopeKey` à partir de `isGovernanceView` / `siteIdToUse` (même formule déjà présente aux l.95, 226, 250, 269, 294) ;
   - dans l'effet l.329-360, ne restaurer que si `cache.cachedAt && cache.scopeKey === scopeKey` ; sinon réinitialiser les états affichés (au minimum `setStats(null)`, `setTotalCloudCartesCount(0)`, `setCloudCartesCount(0)`, `setCentreCardsCount(null)` etc.) puis lancer `loadGlobalData()` / `loadStats()`. Le reset est nécessaire car `SiteAdminView.tsx:600` garde l'ancienne valeur affichée pendant `loading` dès que `stats` est non nul [lu] ;
   - chaque écriture de cache (l.76, 125, 135, 166, 196, 240, 313) doit poser `scopeKey` ;
   - un `useRef` « portée courante » (mis à jour à chaque rendu) sert de garde : avant tout `setState`/`setDashboardCache` posté après un `await` ou dans un `.then`, comparer la portée de l'appel avec la portée courante et abandonner si elles diffèrent.
3. Aucune modification de `authStore.ts` (voir alternative écartée).

**Alternative écartée A — invalider le cache dans `authStore.setActiveSiteId`.** Rejetée : (i) `authStore` n'importe `cacheStore` que dynamiquement dans `logout` (l.83), probablement pour éviter un couplage/cycle ; l'y coupler dans un setter synchrone élargit un composant très partagé (STOP & WARN inutile) ; (ii) `setDashboardCache` ré-estampille `cachedAt` à chaque écriture asynchrone tardive, donc une réponse périmée « re-valide » le cache après l'invalidation ; (iii) ne corrige ni la garde de péremption ni les états du hook (`totalCloudCartesCount`).
**Alternative écartée B — cache par site (`Record<scopeKey, snapshot>`).** Meilleur taux de réutilisation, mais refonte plus large du store partagé et rétention mémoire multipliée par le nombre de sites (Low-Memory §2) ; disproportionné pour un gain de quelques centaines de ms. À ne reconsidérer que si le rechargement à chaque bascule est jugé trop lent (voir Q1).
**Alternative écartée C — supprimer purement le cache.** Perd la fluidité de retour sur page voulue par le projet (déverrouillage `initialDataLoading` l.350).

**Fichiers à modifier (périmètre minimal)**
- `src/renderer/src/stores/cacheStore.ts` (PARTAGÉ, champ optionnel + `clearCache`)
- `src/renderer/src/pages/dashboard/hooks/useDashboardStats.ts` (PARTAGÉ : consommé par `dashboard/index.tsx` ; voir §2 pour autres consommateurs)

**Cloisonnement §3** : renderer uniquement ; aucune décision de portée serveur n'est modifiée. Les appels IPC continuent de passer `siteIdToUse` (SUPER ADMIN = `activeSiteId`, autres rôles = `user.site_id`, l.95) et les handlers serveur dérivent la portée réelle de `getSecureCurrentUser()` (ex. `resolveScopedSiteId`, `src/main/ipc/handlers.ts:112-125`, `db:getCardCount` l.4660-4676) [lu]. Le correctif réduit le risque d'affichage inter-sites (valeur du site B montrée pour A) sans toucher à ces garde-fous. Interdit de remplacer `user?.role === 'SUPER ADMIN'` côté renderer par une requête SQL : on conserve la formule existante.

**Offline-first / quadriptyque** : sans objet (aucune mutation, lecture seule).

**Risques de régression**
- Perte de la « restauration instantanée » lors d'un retour sur la même portée : conservée (clé identique). Perte uniquement lors d'un changement réel de portée.
- Rôle OPERATEUR_SAISIE : `loadStats` a une branche dédiée (l.108-139) qui n'écrit PAS `stats` ; la clé de portée doit aussi y être posée sinon un cache valide sera rejeté en boucle (chargement à chaque montage). À vérifier par test.
- `loadGlobalData` écrit seulement `globalStats`/`sites` : la clé `'GLOBAL'` ne doit pas être écrasée par une écriture partielle d'une branche site, et inversement.
- Overlay `initialDataLoading` : sur cache rejeté, `loadStats` non silencieux repose sur `setInitialDataProgress`/`setInitialDataLoading(false)` après 300 ms (l.91-93, 209-213) ; vérifier que la bascule de site ne laisse pas l'overlay plein écran (comportement actuel d'un premier chargement).
- Garde de péremption : ne pas bloquer les chargements légitimes (ex. bouton « Actualiser » = `loadStats(…, forceRefresh)` appelé depuis `useForceSyncActions` avec la même portée).

**Composants PARTAGÉS touchés → STOP & WARN (à faire valider)** : `useDashboardStats.ts` (hook utilisé par le tableau de bord de tous les rôles : SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_*), `cacheStore.ts` (store commun à 7 caches).

---

### D2 — Page Import : compteur de cartes obsolète

**Cause racine confirmée [lu]**
- `src/renderer/src/pages/ImportPage.tsx:64-75` : effet de montage à dépendances `[]` ; si `importCache.cachedAt && cardCount !== null`, il copie `cardCount` et ne recharge pas. `fetchCardCount` (l.50-62) calcule le bon `siteIdToUse` mais n'est jamais ré-appelé au changement de `activeSiteId`.
- `src/renderer/src/stores/cacheStore.ts:19-22,76-79,109-111` : `importCache` = `{cardCount, cachedAt}`, sans site.
- `importCache` n'est consommé que par `ImportPage.tsx` (grep sur `src/` : lignes 58, 65 ; aucun autre fichier) [lu]. La page reste montée tant que la route est active ; le changement de site se fait depuis la Sidebar (`Sidebar.tsx:304,313`) [lu].
- Bouton « Purger les cartes locales de ce PC » : `disabled={cardCount === 0 || isPurging}` (`ImportPage.tsx:770`). Un compteur périmé à 0 désactive la purge d'un site non vide ; périmé > 0 l'active sur un site vide (inoffensif, voir garde-fous).
- Garde-fous de la purge confirmés [lu] : confirmation danger + `requirePassword: true` (`ImportPage.tsx:772-778`) ; `executePurge` recalcule `siteIdToUse` au clic depuis `activeSiteId` (l.260) et transmet `Number(siteIdToUse)` ; côté serveur `db:purge` impose SUPER ADMIN/ADMINISTRATEUR_SITE via `verifyUserRole` et, pour ADMINISTRATEUR_SITE, `secureUser.site_id === siteId` (`handlers.ts:4472-4485`), plus verrou `acquireGlobalSyncLock`. Donc un compteur périmé ne peut pas purger « le mauvais site » : le risque est d'affichage/ergonomie (bouton grisé à tort ou actif à vide), pas de fuite. Remarque hors périmètre : `db:purge` ne revérifie pas le mot de passe côté serveur (il est contrôlé côté `confirmService`) [supposé pour la mécanique interne de `confirmService`, non lue ; ne pas modifier ici].

**Solution recommandée**
1. `ImportPage.tsx` : remplacer les dépendances `[]` de l'effet l.64-75 par la portée (`activeSiteId`, `user?.role`, `user?.site_id`) ; n'utiliser le cache que si sa clé de portée correspond, sinon `setCardCount(0)`/`null` transitoire puis `fetchCardCount()`. Ajouter une garde de péremption (compteur de requête ou comparaison de portée) dans `fetchCardCount` pour qu'une réponse lente du site précédent n'écrase pas la valeur courante.
2. `cacheStore.ts` : `importCache` reçoit un champ optionnel `scopeKey`, `setImportCache(cardCount, scopeKey?)` (second paramètre optionnel, rétrocompatible) ; `clearCache` le remet à `null`.
3. Conserver `setCardCount(0)` après purge (l.272) et lui associer la même clé.

**Alternative écartée** : supprimer entièrement la lecture du cache dans ImportPage et toujours appeler `db.getCardCount` au montage et au changement de site. Plus simple, et acceptable (simple `COUNT` local, `queries.getLocalCardCount`), mais modifie la logique de déverrouillage `initialDataLoading` (l.70) et ne réutilise pas la convention de D1. À garder comme variante « minimale » si l'utilisateur préfère ne pas toucher `cacheStore.ts` pour D2 (voir Q3).

**Fichiers** : `src/renderer/src/pages/ImportPage.tsx` (page unique, non partagée), `src/renderer/src/stores/cacheStore.ts` (PARTAGÉ, même édition que D1).

**Cloisonnement §3** : inchangé ; `db:getCardCount` dérive le site de `getSecureCurrentUser()` (rôle actif de la session, `handlers.ts:4668-4673`) [lu].

**Risques** : faibles. Surveiller : page Import pendant un import en cours (`importing`) lors d'un changement de site (déjà possible aujourd'hui ; ne pas ajouter de rechargement qui interfère avec `fetchCardCount()` de fin d'import l.219).

**STOP & WARN** : `cacheStore.ts` uniquement (partagé). `ImportPage.tsx` n'est pas un composant partagé.

---

### D3 — « Dates invalides » : le filtre de nom est sans effet

**Cause racine confirmée [lu]**
- `src/main/ipc/handlers.ts:1829` : `ipcMain.handle('cartes:getInvalidDates', async (_, siteId?, offset = 0, limit = 50) => …)` — pas de 4e paramètre ; l.1837 : `queries.getInvalidDateRecords(resolveScopedSiteId(siteId), offset, limit)` — `query` jamais transmis.
- Le renderer envoie bien `query` (`InvalidFormatView.tsx:56-58`, `debouncedFilters.nom`), le preload le relaie (`src/preload/index.ts:140-141`), le type le déclare (`global.d.ts:86`) [lu].
- La requête gère le filtre : `cartes.queries.ts:1583-1591` (tokens, LIKE sur noms+prenoms, contact, num_secu, id_carte), appliqué au `COUNT(*)` (l.1634) ET à la page (l.1637) → le total reflète déjà le filtre, aucun travail de comptage à ajouter. Aucune utilisation de `getCachedCount` dans cette fonction (comptage direct, pas de cache 10 s à invalider) [lu] ; `getCachedCount` (l.147-170) sert d'autres listings et n'est pas concerné.
- Handlers voisins de référence [lu] : `cartes:getDatesVidesPage` (`handlers.ts:1840-1850`) déclare `(_, siteId?, offset = 0, limit = 50, query?)` et transmet `query` ; `getDoublonsPage` etc. (l.1886+) idem avec `query, filters`.

**Solution recommandée**
- `handlers.ts:1829` : ajouter `query?: string` à la signature ; l.1837 : transmettre `query` (calque exact de `getDatesVidesPage`). Optionnel : ne transmettre que si `typeof query === 'string'` (les voisins ne le font pas ; garde minimale sans effet pour l'UI légitime).
- Aucun changement de `cartes.queries.ts`, du preload, de `global.d.ts`, ni du renderer.

**Alternative écartée** : filtrer côté renderer (post-filtre de la page de 10 lignes). Rejetée : le total/pagination serait faux et le filtre ne trouverait rien hors de la page courante.

**Cloisonnement §3** : inchangé ; la portée reste `resolveScopedSiteId(siteId)` basé sur `getSecureCurrentUser()` (`handlers.ts:112-125`) et le contrôle de rôle `verifyUserRole(...['SUPER ADMIN','ADMINISTRATEUR_SITE','OPERATEUR_QUALITE'])` (l.1833) reste en tête. La clause `site_id = ?` est appliquée aux deux branches de l'UNION (`cartes.queries.ts:1577-1581, 1611, 1630`) et les jetons de recherche sont paramétrés (pas d'injection) [lu].

**Observation hors périmètre (ne pas corriger ici)** : `InvalidFormatView.tsx:24` utilise `?? 1` : un SUPER ADMIN sans site actif interroge le site 1 (silencieux). À signaler à l'utilisateur, non traité.

**Risques** : très faibles. Sans `query` (undefined/''), le comportement est identique (`if (query && query.trim())`, l.1584). Les caractères `%`/`_` saisis ne sont pas échappés (identique aux voisins, comportement connu).

**STOP & WARN** : `src/main/ipc/handlers.ts` est un fichier de handlers IPC commun. La modification est locale à un seul handler, sans changement de contrat de réponse ni de schéma ; à faire valider conformément à §4 malgré tout.

---

## 2. Autres consommateurs du même type de cache (liste, non corrigés)

Recherche : grep `useCacheStore|dashboardCache|importCache|centreDashboardCache|qualiteCache|agentsCache|sitesCache|centresCache|retraitsCache` sur `src/renderer/src` [lu].

| Cache / consommateur | Dépend du site actif ? | Même défaut ? |
|---|---|---|
| `dashboardCache` ← `useDashboardStats.ts` (seul lecteur de `dashboardCache`) ; écrit aussi par `ImportPage.tsx` (invalidation seule) | Oui (SUPER ADMIN) | **D1** |
| `importCache` ← `ImportPage.tsx` uniquement | Oui | **D2** |
| `retraitsCache` ← `RetraitsPage.tsx:55-60` (siteId = `activeSiteId ?? user.site_id` pour SUPER ADMIN), lecture cache l.125-141 : si `cachedAt`, aucune recharge, alors que `load` (l.104-123) change avec `siteId` | Oui | **OUI, même défaut** : un changement de site actif réaffiche les retraits du site précédent. De plus l'effet re-déclenche au changement de période/date (`load` dépend de `period`, `customDate`) mais retombe sur le cache → les filtres de période semblent aussi sans effet une fois le cache posé [supposé : non vérifié en vivant, à confirmer par agent-13] |
| `centreDashboardCache` ← `AdminCentre/views/DashboardView.tsx:37-95` | Non (site/centre = `user.site_id`/`user.centre_id`, pas `activeSiteId`) | Risque indirect seulement si un compte change de rôle/centre sans logout (`setActiveRole`, `authStore.ts:111-128`, ne vide aucun cache) |
| `agentsCache` ← `AgentsPage.tsx:246-285` (liste filtrée par `activeSiteId`) et `LogsPage.tsx:130-147` (liste NON filtrée `users.getAll()`) | Oui pour AgentsPage | AgentsPage : affiche la liste du cache puis recharge toujours silencieusement (`loadData(hasCache)`), donc flash transitoire de l'ancienne liste, pas de valeur durablement fausse. **Contamination croisée** : les deux pages écrivent le même cache avec des périmètres différents ; LogsPage ne s'en sert que pour enrichir des noms (faible gravité) |
| `sitesCache`/`centresCache` ← `SitesPage.tsx:60-101`, `SaisiePage.tsx:244-246`, `SaisieEditModal.tsx:16-40` | Non (listes globales pour SUPER ADMIN ; site fixe sinon) | Non pour le site actif. À noter : `SitesPage` ne recharge pas si cache non vide (l.91) |
| `qualiteCache` | — | Défini dans le store (l.28-31, 115-117) mais **aucun consommateur** dans `src/renderer/src` (code mort) |
| `useVerificationStats.ts:2` | — | Importe `useCacheStore` sans l'utiliser (import mort) |
| Pages non-cache dépendantes de `activeSiteId` (Cartes, Search, Export, Maintenance, Qualité x5 vues, Inventaire/Apurement, etc.) | Oui | Hors sujet : elles rechargent via leurs propres dépendances ; non auditées une par une ici [supposé] |

Aucun autre état « module/global » de type cache non indexé par site n'a été trouvé dans `stores/` (liste non exhaustive : seuls `cacheStore`, `authStore`, `qualityUIStore` ont été croisés) [lu partiellement].

---

## 3. Impact base de données / IPC

- **Schéma SQLite/Supabase** : aucun changement. Pas de migration, `SCHEMA_VERSION` inchangé.
- **D3 et signature IPC** : le canal `cartes:getInvalidDates` passe de 3 à 4 paramètres côté handler. Le preload envoie déjà 4 arguments positionnels (`index.ts:141`) → compatibilité totale ; les anciens appels à 3 arguments restent valides (`query` = undefined).
- **Index SQL** : non nécessaire. La requête filtre par `LIKE '%…%'` (non indexable de toute façon) sur un ensemble déjà restreint par la condition « date invalide » et `site_id`. Même schéma que `getDatesVidesPage` (l.1641+) [lu].
- **Low-Memory §2** : D3 ajoute des `LIKE` sur une sous-requête CTE déjà existante ; pagination `LIMIT/OFFSET` inchangée (10 lignes/page côté vue, `InvalidFormatView.tsx:41`). Pas de boucle ni de rétention. D1/D2 : un seul snapshot par cache conservé (pas de Record par site), donc pas de croissance mémoire ; les garde-fous de péremption évitent des écritures inutiles.
- **Comptage** : le total retourné reflète le filtre (COUNT sur `UnifiedInvalidDates … ${searchWhere}`, l.1634). Aucun cache de comptage à invalider.
- **Quadriptyque offline-first** : non concerné (lecture seule / état UI).

---

## 4. Plan de tests

**Vitest (via Electron, jamais `npm rebuild`, cf. mémoire projet)** :
`$env:ELECTRON_RUN_AS_NODE='1'; & .\node_modules\.bin\electron.cmd node_modules/vitest/vitest.mjs run <fichier>`

Modèles à copier [lu] : `tests/fix-qualite-corriger-format-handler.test.ts` (mock `electron`, mock `../src/main/auth/session-heartbeat` avec `getSecureCurrentUser` piloté, base SQLite jetable via `connection.initDatabase()` dans `os.tmpdir()`, capture du handler par `vi.mocked(ipcMain.handle).mock.calls.find(...)`, insertion de `t_users` réels car `verifyUserRole` lit la vraie table) et `tests/export-rbac.test.ts` (même mécanique, SITE_A/SITE_B).

1. **D3 — test de handler** `tests/fix-dates-invalides-filtre-nom.test.ts` (nouveau fichier, aucune modification de tests existants) :
   - Seed : sites A et B ; sur A, 3 cartes à date invalide (noms différents) + 1 ligne `t_import_anomalies` `DATE_INVALIDE` ; sur B, 1 carte à date invalide au nom identique à l'une de A.
   - Cas : (a) sans `query` → total/rows inchangés (non-régression) ; (b) `query='NOMX'` → seules les lignes correspondantes, `total` = nombre filtré (pas le total global) ; (c) requête multi-jetons ; (d) `query` couvrant la branche `t_import_anomalies` ; (e) cloisonnement : SUPER ADMIN avec siteId=A ne voit pas B ; ADMINISTRATEUR_SITE du site A avec siteId forgé = B reste cantonné sur A (via `getSecureCurrentUser` mocké) ; (f) rôle non autorisé (ex. OPERATEUR_SAISIE) → rejet ; (g) pagination `offset/limit` avec filtre.
   - Preuve de non-régression du bug : le test (b) doit échouer sur le code actuel et passer après correctif.
2. **D1/D2 — logique pure** : extraire (dans le même fichier ou un utilitaire renderer dédié, voir Q4) une fonction pure `computeDashboardScopeKey(role, activeSiteId, siteId, isGovernanceView)` et `shouldRestoreCache(cache, scopeKey)` testables sans React. Test Vitest (environnement node par défaut, vitest.config.ts n'active pas jsdom [lu] ; ne pas introduire jsdom) : mêmes clés pour même portée, clés différentes pour A/B/GLOBAL, rejet si `scopeKey` absent (cache hérité d'avant correctif), `clearCache` remet `scopeKey` à null. Le store zustand `useCacheStore` est testable en node (pas de DOM) : tester `setDashboardCache` / `clearCache` / `setImportCache(count, scopeKey)`.
   - Limite assumée : le comportement des effets React n'est pas couvert par Vitest (pas de jsdom/Testing Library dans le dépôt [supposé : non vérifié dans package.json]) → couvert par e2e.
3. **E2E pour agent-13** (instance isolée, réseau coupé, `.env.e2e`, jamais la production) :
   - Dashboard : SUPER ADMIN, site A (N_A cartes) → site B (N_B) → retour A → « Total cartes » = N_A à chaque étape, sans clic « Actualiser » ; aller-retour passant par la vue gouvernance (site → « Quitter le mode site » → autre site) ; bascule rapide A→B avant la fin du chargement (garde de péremption) ; vérifier aussi « Cartes du site / à télécharger » et la tuile cloud (hors-ligne : -1/valeur attendue).
   - Dashboard non-régression : ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_SAISIE (branche dédiée) : montage → navigation vers une autre page → retour : affichage instantané conservé (cache valide) et valeurs correctes ; après import, `invalidateDashboardCache` force bien un rechargement.
   - Import : SUPER ADMIN A→B→A : le compteur affiché et l'état du bouton « Purger » suivent le site (site vide → désactivé ; site rempli → activé) ; ouvrir la confirmation (mot de passe) puis annuler, sans purger réellement sur un jeu non isolé.
   - Qualité : onglet « Dates invalides », saisir un nom partiel → liste ET total/pagination filtrés ; effacer le filtre → liste complète ; changer de page avec filtre actif.
   - Retraits (§2) : A→B pour vérifier si le défaut s'y reproduit (constat seulement).
4. **Validation statique** : `npx tsc --noEmit` (0 erreur) ; `npm run lint` sans nouvelle erreur (config ESLint 10 flat introduite commit a089175 [lu dans gitStatus]) ; suite Vitest complète via la commande Electron ci-dessus ; `npm run test:e2e` ciblé (`npx playwright test <mot-clé>`). Aucun build/packaging (§1).

---

## 5. Découpage proposé

| Lot | Contenu | Fichiers | Agent (table §6) | Modèle | Raison |
|---|---|---|---|---|---|
| **Lot 1** | D3 filtre « Dates invalides » + test de handler | `src/main/ipc/handlers.ts` (1 handler), `tests/fix-dates-invalides-filtre-nom.test.ts` (nouveau) | `agent-3-coder` | Haiku ou Sonnet (Sonnet recommandé si le test de handler est écrit par le même agent) | Changement d'une ligne de signature, calque d'un voisin ; la partie test est le vrai travail. Indépendant, livrable en premier (risque le plus bas, gain immédiat terrain) |
| **Lot 2** | D1 + D2 ensemble : clé de portée dans `cacheStore`, hook dashboard, ImportPage, tests de logique pure | `src/renderer/src/stores/cacheStore.ts`, `.../dashboard/hooks/useDashboardStats.ts`, `src/renderer/src/pages/ImportPage.tsx`, tests Vitest | `agent-3-coder` (UI de logique d'état, pas de CSS) ; `agent-2-designer` non requis (aucun changement visuel) | Sonnet | Logique asynchrone/races dans un hook partagé : plus subtil qu'un simple correctif, mais le périmètre est borné et le plan précis. Opus non justifié |
| **Lot 3** (optionnel, après décision) | Même défaut sur `RetraitsPage` (§2) | `src/renderer/src/pages/RetraitsPage.tsx` (+ champ `scopeKey` sur `retraitsCache`) | `agent-3-coder` | Sonnet | Hors demande initiale ; à lancer seulement sur accord (STOP & WARN §4) |
| **Vérification** | Après chaque lot : e2e vivant (§4.3), puis audit de non-régression | `e2e/specs/…` (nouveaux specs préfixés `_agent13_`) | `agent-13-qa-terrain-tester` (UX terrain, CLAUDE.md §9.2 non requis si aucun nouvel élément UI) ; `agent-9-senior-auditor` pour le non-régression du hook partagé (§9.1) | Sonnet (agent-13), Opus déconseillé | Les deux réflexes de vigilance restent soumis à validation explicite |

**D1 et D2 ensemble ?** Oui pour le code : les deux touchent `cacheStore.ts` (une seule édition du store partagé, convention `scopeKey` commune), mais commits séparés (un commit D1, un commit D2) pour pouvoir les annuler indépendamment. D3 est strictement indépendant (main process, aucun lien avec les caches) : le livrer d'abord, séparément. Chaque commit suit §5 (tsc OK → commit → `release-notes.md` brouillon → push, autorisation permanente) et §8 (entrée sous « Corrections & Fiabilité »).

---

## 6. Liste STOP & WARN à faire valider avant exécution

1. « Attention, cette modification touche à `src/renderer/src/pages/dashboard/hooks/useDashboardStats.ts`, ce qui peut impacter le tableau de bord de tous les rôles (SUPER ADMIN, ADMINISTRATEUR_SITE, ADMIN_CENTRE, OPERATEUR_SAISIE/QUALITE/…), l'indicateur cloud et l'abonnement `sync:cards-received`. Plan de protection : clé de portée identique pour une même portée (restauration instantanée conservée), branche OPERATEUR_SAISIE testée, garde de péremption sur les écritures asynchrones, e2e multi-rôles + audit non-régression `agent-9`. »
2. « Attention, cette modification touche à `src/renderer/src/stores/cacheStore.ts`, store commun à 7 caches (dashboard, import, centre, qualité, agents, sites/centres, retraits). Plan de protection : ajout de champs **optionnels** uniquement, `setImportCache` avec 2e paramètre optionnel, aucune signature supprimée, `clearCache` aligné, aucun autre cache modifié. »
3. « Attention, cette modification touche à `src/main/ipc/handlers.ts` (handler `cartes:getInvalidDates` seul), ce qui peut impacter la vue Qualité « Dates invalides ». Plan de protection : un paramètre optionnel ajouté, aucune modification de réponse, du contrôle de rôle ni de `resolveScopedSiteId`, test de handler (non-régression sans `query` + filtre + cloisonnement). »
4. Non touchés : `authStore.ts`, `cartes.queries.ts`, `schema.ts`, preload, `global.d.ts`, sync-engine, outbox.

---

## 7. Questions de décision pour l'utilisateur

- **Q1 — Cache du dashboard : invalidation/portée vs cache par site.** Recommandé : un seul snapshot étiqueté par portée (rechargement à chaque vrai changement de site, une requête `stats:get` locale ; à noter que la mémoire projet signale `stats:get` parfois lent [à reconfirmer]). Alternative : un cache par site (plus fluide, plus de code et de mémoire). Choix ?
- **Q2 — La clé de portée doit-elle inclure le rôle actif et le centre ?** (`SITE:<id>:<role>:<centre>`). Inclure le rôle corrige aussi un risque voisin : changement de rôle via `setActiveRole` (`authStore.ts:111-128`) sans vidage du cache. Recommandé : oui (coût nul), mais élargit légèrement le comportement.
- **Q3 — ImportPage : conserver le cache avec clé de portée (recommandé, cohérence avec D1) ou supprimer la lecture du cache et toujours recompter ?** La seconde est plus simple et évite de toucher `cacheStore.ts` pour D2.
- **Q4 — Où placer la logique pure testable** (`computeScopeKey`, `shouldRestoreCache`) : dans `cacheStore.ts` (aucun nouveau fichier) ou dans un nouvel utilitaire `src/renderer/src/utils/` (nouveau fichier, non partagé) ? Recommandé : nouvel utilitaire, pour garder le store minimal.
- **Q5 — Bouton « Purger » :** conserver la règle `cardCount === 0 → désactivé` (recommandé, une fois le compteur fiable) ou l'activer tout le temps (la purge reste protégée par confirmation + mot de passe + contrôle serveur) ? Pas de changement de comportement proposé par défaut. Question annexe : afficher un état « calcul en cours » (bouton grisé) pendant le recomptage du nouveau site, plutôt que `0` transitoire ?
- **Q6 — Étendre au défaut Retraits (Lot 3) maintenant, ou le consigner dans `TASKS.md`/mémoire pour plus tard ?**
- **Q7 — Point hors périmètre** : `InvalidFormatView.tsx:24` retombe sur le site 1 pour un SUPER ADMIN sans site actif ; à consigner ou corriger ?

---

## 8. Documentation / mémoire (à la clôture des lots)

- `release-notes.md` (brouillon cumulatif, §8) : une entrée « Corrections & Fiabilité » par commit (D3 ; D1 ; D2). Ne pas toucher `package.json` ni `CHANGELOG.md`.
- Aucun changement de `SCHEMA_VERSION`.
- Le présent fichier est le seul fichier écrit par cette mission.

## 9. Ce qui n'a pas été vérifié

- Reproduction vivante des 3 défauts (c'est le rôle d'agent-13) ; le scénario « 0 puis 23 puis 23 » est une reconstruction cohérente avec le code, pas une observation.
- Comportement interne de `confirmService` (mot de passe) et de `useForceSyncActions`.
- Contenu de `package.json` (présence ou non de jsdom/Testing Library) ; supposé absent car `vitest.config.ts` n'en configure aucun.
- Autres pages dépendantes de `activeSiteId` (non auditées une par une).
