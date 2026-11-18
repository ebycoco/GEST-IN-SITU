# Plan P1 du chantier B — version corrigée (2026-11-13, mise à jour 2026-11-18)

Base : plan d'agent-1 du 2026-11-13 (résumé dans `RELAIS.md`, sections « Plan P1 chantier B »,
« Résultats P1-0 », « Lecture prod des règles d'accès »), corrigé par agent-4 après l'alignement
du projet dev et les essais P1-0. Le texte détaillé d'origine d'agent-1 (choix C1-C10, découpage
fin des migrations 0008-0012) **n'est pas présent sur disque** : les points repris ci-dessous en
dépendent seulement là où c'est indiqué « (agent-1) ».

Rappels permanents :
- P1 est **entièrement additif côté cloud** : rien dans `src/` (le client avec badge, c'est P2).
- Aucune écriture sur la prod (`itvyayakwgzvfqvdrgyv`) par un agent : chaque geste prod est fait
  par l'utilisateur dans le SQL Editor, après passage sur le dev (`ajadkziqaskadlzboeqo`).
- Aucune clé, aucun hash, aucun mot de passe dans le chat, un commit ou le Second-cerveau.
- Une migration = un fichier `supabase/migrations/NNNN_*.sql` + un test `supabase/tests/NNNN_*.test.sql`
  (transaction annulée), appliqués dev puis prod (README des migrations).

## Décisions par défaut

| Sujet | Décision retenue par défaut |
|---|---|
| C1-C10 | Recommandations d'agent-1 retenues par défaut, recopiées en annexe A (fin de fichier). |
| 0007 | **STOP & WARN maintenu** : le garde 0007 neutralise les gestes SA faits avec la clé anon. Il devra être adapté (laisser passer un appelant `authenticated` légitime) **avant P2**, pas en P1. Ne pas le modifier pendant P1. **Q6 (2026-11-18)** : l'adaptation sera une **nouvelle migration 0015** (renumérotée le 2026-11-18 : 0014 = filtre par rôle) ; le fichier 0007 n'est jamais modifié. |
| Ordre en prod | **P1-1 (mesure) et P1-2 (versions) d'abord**, seuls, pour commencer à collecter. Le reste suit après validation sur le dev. |
| Ancienne clé anon prod | **D6 scindée le 2026-11-18 (Q2).** **D6a = couper la clé legacy** (JWT anon de prod qui a fuité) : seulement si (1) la **preuve contrôlée** de P1-1b a donné `legacy_suppose` ; (2) pendant **7 jours consécutifs**, 0 compteur `legacy_suppose` **et** 0 compteur `autre` avec `jwt_role = 'anon'` dans `t_write_audit`, vérifié en lisant aussi `claim_keys` (toute forme de claims inconnue bloque D6a) et pas seulement `classe` ; (3) tous les postes en ≥ 2.26.1 (anciens postes mis à jour, Q7 ; source : P1-1b). Les écritures `publishable` continuent. **D6b = fermer anon (P3)** : seulement quand tout le parc est en version P2 (badge) **et** 7 jours consécutifs sans aucune écriture anon (`publishable`, `legacy_suppose`, `autre` anon). Aucune autre échappatoire. Gestes de l'utilisateur. |

## Décisions de l'utilisateur du 2026-11-18 (« Oui, toutes »)

| # | Décision |
|---|---|
| Q1 | Preuve P1-1b **maintenant** : un appel avec l'ancienne clé, fait par l'utilisateur (procédure en P1-1b). |
| Q2 | D6 scindée : **D6a** couper la clé legacy (anciens postes mis à jour) ; **D6b** fermer anon = P3 (tout le parc en version P2 + 7 jours sans écriture anon). |
| Q3 | `verifyOtp` fait par le **poste** avec le `token_hash` renvoyé par `gis-login` ; limites de débit Auth **inchangées**. |
| Q4 | Écritures `authenticated` filtrées **par site seulement** en P1-6 (filtre par rôle revu pour la PWA). **Complété le 2026-11-18** (décision D-R ci-dessous) : filtre par rôle ajouté pour les écritures sur `t_sites`, `t_centres`, `t_postes` (migration 0014) ; les autres tables restent filtrées par site seulement. |
| Q5 | Un SUPER ADMIN garde **son propre** hash sur un poste où il s'est connecté en ligne, **jamais** via la liste du site (précise D1). |
| Q6 | Adaptation du garde 0007 = **nouvelle migration 0015** (était 0014, renumérotée le 2026-11-18), sans modifier 0007. Fond inchangé. |
| Q7 | Relancer la mise à jour des postes ABO restés en ancienne version (geste terrain). |
| Q8 | Colonne `actor_sync_id` dans `t_outbox` (SQLite V74) en **P2**. |

## Décisions de l'utilisateur du 2026-11-18 (suite, après P1-6)

| # | Décision |
|---|---|
| D-EF | **Échec fermé CONFIRMÉ** : un jeton `authenticated` sans claims `gis_*` (ou sans `gis_v`) n'a accès à rien. Déjà le cas dans 0013, rien à changer ; vérifié de nouveau par le test 0014 (cas 10 et 11). |
| D-R | **Filtre par rôle des écritures** `authenticated` sur `t_sites`, `t_centres`, `t_postes` (migration **0014**), aligné sur l'application : `t_sites` = SUPER ADMIN seulement ; `t_centres` = SUPER ADMIN ou `ADMINISTRATEUR_SITE` de son site ; `t_postes` = SUPER ADMIN ou `ADMINISTRATEUR_SITE` de son site (aucun handler de poste dans l'appli ; aligné sur les centres). `ADMIN_CENTRE` et `OPERATEUR_*` : aucune écriture. Lecture inchangée (0013). Sources : `src/main/ipc/handlers.ts:4015`, `:4028`, `:4045`, `:4160`, `:4227`, `:4315`, `:76` ; `src/main/database/queries/hierarchy.queries.ts:783` ; `src/renderer/src/App.tsx:339`. |
| Numérotation | 0014 = filtre par rôle ; l'adaptation du garde 0007 (Q6) passe en **0015**. |

À préparer pour la future PWA dès P1/P2 : claims liés à la **personne** (pas au poste, aucun
`poste_key` obligatoire), identifiants **cloud** uniquement (jamais d'id local), `gis-login`
appelable depuis un navigateur (CORS), aucun hash lisible par `authenticated`, limite des
30 jours (D3) appliquée par le **hook** au `token_refresh` (les limites de session Supabase
relèvent d'un plan payant, non vérifié).

## Constats qui changent le plan initial

1. **Dev ≠ prod (corrigé)** : sur le dev, la RLS était désactivée sur 6 tables principales ; en prod
   elle est active avec une politique PERMISSIVE `allow_all_operations_*` TO anon, authenticated,
   service_role. Alignement fait (P1-A ci-dessous).
2. **L'en-tête `apikey` n'arrive pas dans Postgres** (`request.headers` ne le contient pas, P1-0 S1).
   On ne peut donc pas distinguer la clé par son préfixe. Discriminant retenu : la **forme des claims**
   (`request.jwt.claims`) — clé publishable : `{"role":"anon"}` seul (vérifié sur le dev) ; clé legacy
   (JWT) : présence attendue de `iss`, `ref`, `iat`, `exp` (**supposé**, d'après la doc ; la clé legacy
   du dev est désactivée et n'a pas été réactivée). Preuve à faire en prod (P1-1b).
3. **Un seul trigger `AFTER INSERT OR UPDATE … REFERENCING` est refusé par Postgres 17** (P1-0 S6) :
   il faut un trigger STATEMENT par opération. Sur un upsert `ON CONFLICT DO UPDATE`, les triggers
   INSERT **et** UPDATE se déclenchent à chaque appel, même à 0 ligne : les tables de transition
   vides doivent être ignorées.
4. **pgcrypto ne reconnaît pas `$2b$`** (P1-0 S4) : normaliser `$2b$`/`$2y$` → `$2a$` si une
   vérification se fait en SQL.
5. **S2 non prouvé** (`generateLink` + `verifyOtp` côté serveur) faute de clé secrète du dev.
6. **S5 : limites de débit Auth** (`/auth/v1/verify` 360/h par IP, `/auth/v1/token` 1800/h par IP,
   doc) : si toutes les connexions passent par l'IP de l'Edge Function, risque réel de blocage.
7. **Politiques RESTRICTIVE TO authenticated sans effet sur anon (vérifié en prod, lecture seule
   2026-11-13)** : `anon` n'est membre d'aucun rôle (`pg_has_role('anon','authenticated') = false`),
   et ses accès passent par les politiques permissives existantes TO anon. Une politique RESTRICTIVE
   ciblant `authenticated` ne s'applique qu'à ce rôle. `service_role` a `BYPASSRLS`.

---

## Étapes

### P1-0 — Essais sur le dev — FAIT (2026-11-13)
- Résultats : `RELAIS.md`, section « Résultats P1-0 ». Coût 0.

### P1-A — Aligner la sécurité du dev sur la prod — FAIT (2026-11-13)
- **Fichiers** : `supabase/migrations/dev_align_rls_prod.sql` (hors numérotation, en-tête
  « DEV UNIQUEMENT »).
- **Agent** : agent-4.
- **Fait** : politiques `allow_all_operations_*` créées et RLS activée (non forcée) sur t_cartes,
  t_centres, t_logs, t_postes, t_sites, t_users du dev.
- **Tests** : même requête de catalogue sur dev et prod → empreinte identique
  (`fd5ff21d95bc17b91aa7073e48b6ebef`, 11 tables, 11 politiques) ; upsert + select réels avec la clé
  publishable du dev sur t_sites, t_cartes, t_users : OK, lignes de test supprimées ; tests SQL
  0006 (19/19) et 0007 (20/20) rejoués sur le dev, transactions annulées.
- **Écarts restants connus, non traités (hors sécurité)** : `t_app_version` existe sur le dev
  seulement (inutilisée par `src/`) ; le dev a 11 clés étrangères absentes de la prod ; la prod a
  une contrainte CHECK `escalade_niveau` et 2 valeurs par défaut (`escalade_niveau`,
  `has_invalid_date`) absentes du dev. À garder en tête pour les essais d'écriture.
- **Critère de fin** : atteint.
- **Geste utilisateur** : aucun.

### P1-1 — Mesure des écritures par type de clé (dev puis prod) — FAIT SUR LE DEV ET EN PROD (2026-11-13)
- **Prod** : appliquée le 2026-11-13 vers 23 h 40 (vérification préalable 5/5 OK, contrôle
  post-application 12/12 OK, compteurs vides à l'application). Prochaine étape : P1-1b (preuve
  contrôlée avec l'ancienne clé) et collecte.
- **Résultat dev (agent-4)** : 0008 appliquée sur le dev (24 triggers actifs, interrupteur
  actif). Test SQL 0008 **20/20** ; tests 0006 **19/19** et 0007 **20/20** rejoués après coup
  (transactions annulées). Appels REST réels avec la clé publishable du dev (supabase-js
  2.105.1) : t_cartes INSERT 1 instruction / 3 lignes, UPDATE 2 / 4 (upsert de 3 + update de 1),
  DELETE 1 / 3 ; t_users INSERT, UPDATE, DELETE 1 / 1 chacun ; tous classés `publishable`,
  `claim_keys = role`, `client_info = supabase-js-node/2.105.1`. Lecture de `t_write_audit` et
  modification de `t_write_audit_config` par anon : refusées (42501).
- **Contention** : 10 upserts parallèles de 20 cartes : 0 erreur, 10 instructions / 200 lignes
  comptées (aucune perte). Ligne de compteur verrouillée 4 s par une autre transaction : les
  3 requêtes tombées pendant ce temps ont pris ~370 ms au lieu de ~150 ms (attente bornée par
  `lock_timeout = 200ms`), 0 erreur, leurs 3 compteurs perdus (comportement prévu) ; les 9
  autres comptées. `ON CONFLICT DO UPDATE` suffit pour l'unicité ; le `lock_timeout` borne
  l'attente des transactions longues.
- **Surcoût (upsert de 500 cartes)** : en REST, médianes sur 7 essais — triggers actifs
  235 ms (insertion) / 234 ms (mise à jour) ; interrupteur coupé 240 / 235 ; triggers désactivés
  227 / 243 : écart dans le bruit réseau. Côté serveur (mesure dans Postgres, bruitée) : de
  l'ordre de +3 ms à l'insertion et +10 à 15 ms à la mise à jour pour 500 lignes (25 à 50 ms
  au total). Jugé acceptable.
- **Nettoyage** : cartes, comptes, site, compteurs et versions de test supprimés ; contrôle :
  t_cartes, t_users, t_sites, t_logs, t_write_audit, t_client_versions = 0 ligne ; tables et
  triggers laissés en place sur le dev.
- **Correctif après audit agent-9 (2026-11-13, agent-4)** : `SET LOCAL lock_timeout = '3s'` +
  contrôle d'arrêt en tête du fichier (application `BEGIN; <fichier> COMMIT;`), `classe` ajoutée à
  la clé primaire et à l'`ON CONFLICT`, `anon` sans claims lisibles classé `autre` (et non plus
  `publishable`), blocs de retour arrière protégés, ordre d'urgence. Dev : retour arrière (tables
  vides vérifiées) puis réapplication. Tests : 0008 **26/26** (6 cas ajoutés : écriture gardée
  par 0006 comptée selon les lignes réellement écrites ; écritures ignorées par 0007 R5/R6 → 0
  ligne comptée ; `lock_timeout` appelant restauré ; `authenticated` refusé sur les deux tables ;
  `TRUNCATE` refusé ; anon sans claims → `autre`), 0009 **17/17**, 0006 **19/19**, 0007
  **20/20**. Appel REST réel (clé publishable du dev) : INSERT/UPDATE/DELETE t_cartes et t_sites
  classés `publishable`, `claim_keys = role` (donc claims réelles `{"role":"anon"}`) ; RPC
  refusée (42501). Requête de contrôle du README : 12/12 OK. Dev nettoyé.
- **Reste** : ~~application en prod~~ faite le 2026-11-13 (voir « Prod » ci-dessus) ; reste P1-1b.
- **Fichiers** : `supabase/migrations/0008_mesure_ecritures_cles.sql`,
  `supabase/tests/0008_mesure_ecritures_cles.test.sql`.
- **Agent** : agent-4 (écriture + dev), utilisateur (prod).
- **Contenu** :
  - table `t_write_audit` (RLS active, aucune politique, aucun GRANT anon/authenticated) :
    `jour date`, `table_name`, `op`, `jwt_role`, `claim_keys text` (liste triée des **noms** de
    clés de `request.jwt.claims`, jamais les valeurs), `client_info` (`x-client-info`), `classe`
    (`publishable` / `legacy_suppose` / `authenticated` / `service_role` / `postgres` / `autre`),
    `nb_instructions`, `nb_lignes`, `derniere_vue` ; clé unique sur
    (jour, table_name, op, jwt_role, claim_keys, client_info) → **compteur** (upsert +1), pas une
    ligne par appel.
  - fonction `SECURITY DEFINER`, `search_path` fixé, bloc `EXCEPTION WHEN others` qui ne renvoie
    jamais d'erreur au poste (comme 0006/0007).
  - **deux triggers STATEMENT** par table surveillée : `AFTER INSERT … REFERENCING NEW TABLE` et
    `AFTER UPDATE … REFERENCING NEW TABLE`, + `AFTER DELETE … REFERENCING OLD TABLE` (utile : la
    purge et la suppression d'agents passent par anon). Si la table de transition est vide (cas
    normal de l'upsert : un des deux triggers voit 0 ligne), **rien n'est écrit**.
  - Tables surveillées : t_cartes, t_users, t_user_roles, t_logs, t_sites, t_centres, t_postes,
    t_user_presence.
  - Classement : `role='anon'` avec claims lisibles `AND NOT (claims ? 'iss')` → `publishable` ;
    `role='anon' AND claims ?& array['iss','ref','iat','exp']` → `legacy_suppose` ; `role='anon'`
    **sans** claims lisibles (rôle lu seulement dans `request.jwt.claim.role`) → `autre`.
- **Tests (dev)** : test SQL en transaction annulée (claims simulées : publishable, JWT legacy
  simulé, authenticated, service_role, postgres sans claims ; upsert à 0 ligne ; DELETE ; aucune
  valeur de claim stockée) ; appel REST réel avec la clé publishable du dev → une ligne
  `publishable` ; mesure du surcoût sur un upsert de 500 cartes (comparaison avec/sans triggers).
- **Critère de fin** : test SQL tout vert, appel réel classé `publishable`, surcoût mesuré et
  jugé acceptable, objets de test supprimés.
- **Geste utilisateur** : appliquer 0008 en prod (SQL Editor) après validation dev.

### P1-1b — Preuve en prod de la forme des claims « legacy » (sous-étape de P1-1) — À FAIRE (Q1, 2026-11-18)
- **But** : prouver, sans lire aucune clé, qu'un appel fait avec l'**ancienne** clé anon de prod
  est bien classé `legacy_suppose` (et qu'un appel avec la clé publishable est classé
  `publishable`). C'est la condition (1) de D6a.
- **Ce qui a changé depuis le plan du 2026-11-13** : la RPC `fn_report_client_version` est
  **ouverte** à anon/authenticated depuis le 2026-11-14 (README des migrations, entrée 0010).
  **Il n'y a donc plus de GRANT/REVOKE à faire** autour de la preuve. Et la collecte de 0008 voit
  déjà, chaque jour depuis le 14/11, des écritures `legacy_suppose` avec les claims
  `exp, iat, iss, ref, role` (lecture du 2026-11-17) : la preuve contrôlée confirme que c'est
  bien l'ancienne clé qui produit cette forme.
- **Vérifié dans les fichiers (2026-11-18)** : signature `fn_report_client_version(p_poste_key TEXT,
  p_app_version TEXT, p_user_sync_id TEXT DEFAULT NULL, p_site_sync_id TEXT DEFAULT NULL)`
  renvoie un booléen (`0009_versions_postes.sql:124-130`) ; `p_poste_key` doit respecter
  `^[A-Za-z0-9_-]{8,64}$` et `p_app_version` le format `x.y.z` (`0009:140-147`) ; la classe est
  calculée côté serveur par `fn_write_audit_classe()` et rangée dans
  `t_client_versions.key_kind` (`0009:167`). **Attention** : cet appel n'écrit **que** dans
  `t_client_versions` ; il ne crée **aucune** ligne dans `t_write_audit` (`t_client_versions`
  n'est pas une table surveillée par 0008, `0008:54-55`) et `t_client_versions` ne garde pas
  les noms des claims (`claim_keys`). La preuve se lit donc dans `key_kind` ; les `claim_keys`
  se lisent dans `t_write_audit` pour les écritures réelles des postes (étape 4).
- **Procédure (geste de l'utilisateur, ~10 minutes, PowerShell sur son poste + SQL Editor de la
  PROD)** — la valeur des clés n'est jamais collée dans un chat, un fichier ou une commande
  enregistrée :
  1. **Préparer.** Dans le tableau de bord Supabase de la **prod** : Settings > API Keys. Onglet
     « Legacy API Keys » : repérer la clé `anon` (l'**ancienne**, `<ANCIENNE_CLE>`) ; onglet
     « API Keys » : repérer la clé **publishable** (`<CLE_PUBLISHABLE>`). Ne rien copier pour
     l'instant. Si l'onglet Legacy indique que les anciennes clés sont **désactivées**, s'arrêter :
     la preuve n'a plus d'objet (D6a déjà faite), le noter.
     Dans le SQL Editor de la prod, contrôle préalable (lecture seule, 3 lignes `OK` attendues) :
     ```sql
     SELECT 'RPC ouverte a anon' AS verification,
            CASE WHEN has_function_privilege('anon', 'public.fn_report_client_version(text,text,text,text)', 'EXECUTE')
                 THEN 'OK' ELSE 'KO - ARRETER' END AS resultat
     UNION ALL
     SELECT 'aucune ligne preuve-% deja presente',
            CASE WHEN NOT EXISTS (SELECT 1 FROM public.t_client_versions WHERE poste_key LIKE 'preuve-%')
                 THEN 'OK' ELSE 'A NETTOYER (etape 5) PUIS RECOMMENCER' END
     UNION ALL
     SELECT 'mesure 0008 active',
            CASE WHEN (SELECT enabled FROM public.t_write_audit_config WHERE id = 1)
                 THEN 'OK' ELSE 'KO - ARRETER' END;
     ```
  2. **Appel avec l'ancienne clé.** Ouvrir PowerShell, coller ces lignes **une par une** :
     ```powershell
     $url = "https://itvyayakwgzvfqvdrgyv.supabase.co/rest/v1/rpc/fn_report_client_version"
     $k = Read-Host "Collez l'ANCIENNE cle anon puis Entree"
     $h = @{ apikey = $k; Authorization = "Bearer $k"; "x-client-info" = "preuve-p1-1b/legacy" }
     Invoke-RestMethod -Method Post -Uri $url -Headers $h -ContentType "application/json" -Body '{"p_poste_key":"preuve-legacy-0001","p_app_version":"0.0.1"}'
     Remove-Variable k, h
     ```
     Réponse attendue : `True`. (`Read-Host` évite que la clé reste dans l'historique des
     commandes ; à la place de `<ANCIENNE_CLE>`, on colle la valeur seulement dans cette invite.)
     Si la réponse est une erreur 401 « Invalid API key » : l'ancienne clé est déjà coupée,
     noter et passer à l'étape 3. Si `False` : transmettre tel quel, ne pas réessayer en boucle.
  3. **Contre-épreuve avec la clé publishable.** Même chose avec `<CLE_PUBLISHABLE>` :
     ```powershell
     $k = Read-Host "Collez la cle PUBLISHABLE puis Entree"
     $h = @{ apikey = $k; Authorization = "Bearer $k"; "x-client-info" = "preuve-p1-1b/publishable" }
     Invoke-RestMethod -Method Post -Uri $url -Headers $h -ContentType "application/json" -Body '{"p_poste_key":"preuve-publishable-0001","p_app_version":"0.0.1"}'
     Remove-Variable k, h, url
     ```
     Réponse attendue : `True`.
  4. **Lire le résultat** (SQL Editor de la prod, lecture seule) :
     ```sql
     -- a) La preuve : classe calculee par le serveur pour chaque appel
     SELECT poste_key, key_kind, client_info, first_seen_at
     FROM public.t_client_versions
     WHERE poste_key IN ('preuve-legacy-0001', 'preuve-publishable-0001')
     ORDER BY poste_key;
     -- attendu : preuve-legacy-0001 -> legacy_suppose ; preuve-publishable-0001 -> publishable

     -- b) Formes de claims vues sur les ecritures reelles des postes (7 derniers jours)
     SELECT jour, classe, jwt_role, claim_keys, client_info,
            sum(nb_instructions) AS instructions, sum(nb_lignes) AS lignes
     FROM public.t_write_audit
     WHERE jour >= current_date - 7
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY 1 DESC, 2;
     -- attendu : legacy_suppose avec claim_keys = exp,iat,iss,ref,role ; publishable avec claim_keys = role ;
     -- toute autre forme (classe 'autre' avec jwt_role = 'anon', claims inconnues) bloque D6a jusqu'a explication.
     ```
  5. **Nettoyer** (SQL Editor de la prod ; résultat attendu `DELETE 2`, ou `DELETE 1` si
     l'ancienne clé était déjà coupée) :
     ```sql
     DELETE FROM public.t_client_versions WHERE poste_key LIKE 'preuve-%';
     ```
     Aucun compteur `t_write_audit` à supprimer : l'appel RPC n'en a pas créé (voir plus haut).
     Les lignes `preuve-%` sont de toute façon écartées de l'écran « Versions des postes »
     (`0010`, comptées dans `nb_preuve`).
- **Si `key_kind` de `preuve-legacy-0001` n'est pas `legacy_suppose`** : ne rien décider ;
  corriger le classement de 0008 (nouvelle migration) et refaire la preuve.
- **Collecte** : 0008 enregistre rôle + noms des claims + x-client-info. Les postes < 2.26.1
  apparaissent en `legacy_suppose`, les postes ≥ 2.26.1 en `publishable`.
- **Agent** : agent-4 (lecture des compteurs agrégés, lecture seule, avec accord).
- **Critère de fin (= conditions de D6a)** : preuve contrôlée = `legacy_suppose` ; puis 7 jours
  consécutifs avec **0** compteur `legacy_suppose` **et 0** compteur `autre` dont
  `jwt_role = 'anon'`, contrôlé en lisant `classe`, `jwt_role` **et** `claim_keys` (une forme de
  claims nouvelle ou inattendue bloque la décision jusqu'à explication).
  Requête de lecture : requête (b) ci-dessus.
- **Condition « tout le parc ≥ 2.26.1 »** : **partiellement mesurable depuis 2.27.0** : les
  postes ≥ 2.27.0 se déclarent dans `t_client_versions` (écran SUPER ADMIN « Versions des
  postes », ou `SELECT * FROM public.fn_list_client_versions();`). Les postes plus anciens
  (< 2.27.0) **ne peuvent pas** se déclarer : pour eux, la source reste l'**inventaire manuel**
  poste par poste et l'absence de `legacy_suppose` dans la collecte. Lecture du 2026-11-17 :
  12 postes déclarés, tous en 2.27.0 ; probablement 2 postes ABO encore en ancienne version
  (déduction par présence sans déclaration, **supposition**) → Q7 : relancer leur mise à jour.
- **Geste utilisateur** : preuve contrôlée (procédure ci-dessus) ; mise à jour des postes ABO
  restants (Q7) ; laisser tourner ; autoriser la lecture des compteurs.

### P1-2 — Table des versions de postes (dev puis prod) — FAIT SUR LE DEV ET EN PROD (2026-11-13)
- **Prod** : appliquée le 2026-11-13 juste après 0008, RPC fermée (contrôle 12/12 OK).
  **Depuis le 2026-11-14, la RPC `fn_report_client_version` est OUVERTE à anon/authenticated**
  (GRANT fait en prod après la publication de v2.27.0, sur accord écrit ; README des migrations,
  entrée 0010). Les postes ≥ 2.27.0 déclarent leur version. Pour la refermer :
  `REVOKE EXECUTE ON FUNCTION public.fn_report_client_version(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;`
  (rejouer 0009 la referme aussi).
- **Résultat dev (agent-4)** : 0009 appliquée sur le dev ; test SQL **14/14** (paramètres
  bornés, une ligne par poste, plafond 5000 postes, classe de clé calculée côté serveur, table
  illisible et non modifiable par anon). Appel REST réel `fn_report_client_version` avec la clé
  publishable : `true`, ligne `key_kind = publishable` ; appel invalide : `false` sans erreur ;
  SELECT et INSERT directs sur `t_client_versions` par anon : refusés (42501). Ligne de test
  supprimée. Aucun appel côté poste (P2).
- **Correctif après audit agent-9 (2026-11-13)** : la RPC est **fermée par défaut**
  (`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` en fin de fichier ; les privilèges par
  défaut du schéma public donnent EXECUTE à anon/authenticated, vérifié dans `pg_default_acl`
  du dev). ~~Ouverte seulement le temps de la preuve contrôlée P1-1b, puis en P2.~~ Ouverte
  durablement le 2026-11-14 avec v2.27.0 (écran « Versions des postes »). Test 0009
  **17/17** (RPC fermée : appels anon/authenticated réels refusés ; rouverte le temps du test
  dans la transaction annulée ; refermeture). Appel REST réel avec la clé publishable : refusé
  (42501).
- **Fichiers** : `supabase/migrations/0009_versions_postes.sql` + test (contenu : agent-1).
- **Agent** : agent-4.
- **But** : savoir quels postes tournent encore une version qui utilise l'ancienne clé, avant D6.
- **Tests** : test SQL transaction annulée ; écriture réelle avec la clé publishable du dev.
- **Critère de fin** : test vert ; en prod, lecture possible par l'utilisateur.
- **Geste utilisateur** : appliquer 0009 en prod avec 0008 (même fenêtre).

### P1-3 — Diagnostic site/centre (dev, lecture seule en prod) — FAIT DANS LES FAITS (2026-11-13/14)
- **État 2026-11-18** : diagnostic fait et anomalies traitées (cartes du site 6 supprimées, rôles
  principaux ajoutés, sites PLATEAU/ADJAMÉ supprimés). **Clôture formelle à relancer avant P1-6** :
  rejouer `supabase/diagnostics/p1_coherence_sites.sql` en prod (lecture seule, accord de
  l'utilisateur) et vérifier 0 anomalie sur les colonnes que 0013 filtrera (`t_cartes.id_site`,
  `t_logs.site_id`, `t_user_presence.site_id`, `t_users.site_id`).
- **Suite (2026-11-13, nuit)** : sur décision de l'utilisateur (import d'essai), les 2 614 cartes du
  site 6 inexistant ont été **supprimées en prod** après sauvegarde dans
  `public.bak_cartes_site6_20261113` (2 614 lignes, RLS active, illisible pour anon). Contrôle :
  0 carte site 6, 222 472 cartes restantes.
- **2026-11-14** : rôles principaux ajoutés dans `t_user_roles` en prod pour les 2 comptes concernés
  (SUPER ADMIN, ADMINISTRATEUR_SITE) ; contrôle : 0 compte sans son rôle principal. Le hook (P1-5)
  devra quand même lire `t_users.role` en plus de `t_user_roles`.
- **2026-11-14** : sur demande de l'utilisateur, sites PLATEAU (5) et ADJAMÉ (11) supprimés en prod
  avec les 3 centres et le compte admin d'ADJAMÉ, après sauvegarde (`bak_*_20261114`). Restent
  ABOBO (4) et BOCANDA (14) ; 0 compte ni centre orphelin.
- **Fichiers** : requêtes de diagnostic (agent-1), pas de migration si lecture seule.
- **Agent** : agent-4.
- **Lien** : bogue connu « site_id local envoyé au cloud » (mémoire 2026-10-27), à mesurer avant
  d'écrire des politiques filtrées par site.
- **Critère de fin** : liste des comptes/cartes dont le site cloud est incohérent, sans données
  personnelles dans le rapport.
- **Geste utilisateur** : autoriser la lecture prod.
- **Résultat (agent-4, 2026-11-13, PROD itvyayakwgzvfqvdrgyv, SELECT uniquement)** — requête
  réutilisable `supabase/diagnostics/p1_coherence_sites.sql` (4 blocs). Prod : 4 sites, 6 centres,
  0 poste, 17 comptes, 35 rôles, 225 086 cartes, 2 729 journaux, 13 présences.
  - Sain : aucun doublon de code site ni de centre, aucun centre orphelin, aucun compte au site ou
    centre inexistant, aucun compte dont le centre est d'un autre site, aucun non-SA sans site,
    1 SUPER ADMIN (sans site), présences et journaux cohérents en site/centre, 0 sync_id manquant
    (sauf site 5 PLATEAU, vide).
  - **Anomalie 1 (P3)** : 2 614 cartes avec `id_site = 6` et `id_centre` 14/15/16, ni site ni
    centres existants (créées le 2026-08-29, jamais modifiées depuis ; 818 DELIVRE, 1 789 EN STOCK,
    7 DOUBLON). 2 606 partagent leur `cle_doublon` avec une carte d'ABOBO (site 4). Probables ids
    locaux d'ADJAME (site 11, centres 17/18/19 créés le même jour, préfixes CH/UN identiques) :
    **supposition**, non prouvée. Décision utilisateur : rattacher à ADJAME ou supprimer (import
    d'essai en double ?).
  - **Anomalie 2 (P1-4, hook)** : 2 comptes dont le rôle primaire manque dans `t_user_roles`
    (id_user 64 SUPER ADMIN, id_user 247 ADMINISTRATEUR_SITE d'ADJAME). Un hook qui ne lirait que
    `t_user_roles` priverait le SUPER ADMIN de `gis_is_super_admin`.
  - Informatif : 2 070 journaux (11 id_user distincts) dont `id_user` est un id local de poste,
    pas un id cloud : ne pas filtrer t_logs par `id_user` dans les règles. Site 5 PLATEAU sans
    sync_id et vide ; site 14 BOCANDA sans centre (1 admin).
  - Rien n'a été réparé.

### P1-4 — Prérequis S2 : clé secrète du dev — FAIT (2026-11-13)
- **Résultat : S2 prouvé en réel sur le dev.** `admin.createUser` (email synthétique, `app_metadata.sync_id`)
  → `generateLink({type:'magiclink'})` → `properties.hashed_token` → `verifyOtp({ token_hash, type:'magiclink' })`
  renvoie une session (`role`/`aud` = authenticated, 1 h, `app_metadata.sync_id` présent dans le jeton),
  aussi bien avec le client public (publishable) qu'avec le client admin. Aucun courriel envoyé
  (logs Auth). Utilisateur de test supprimé, 0 jeton ni session restants.
- **Conséquence C3** : voie `generateLink` + `verifyOtp` retenue.
- **Conséquence S5 (recommandation)** : l'Edge Function renvoie seulement le `token_hash` ; c'est le
  **poste** qui appelle `verifyOtp` (prouvé possible avec la clé publishable). Ainsi les vérifications
  ne partagent pas toutes l'IP de la fonction (limite `/auth/v1/verify` 360/h par IP). IP vue derrière
  une vraie Edge Function : non observée.
- **Rappel** : supprimer la clé secrète du dev dans le tableau de bord à la fin de P1.
- **Geste utilisateur (bloquant pour P1-5)** : créer/copier une clé **secrète du projet dev**
  dans `.env.e2e` sous le nom `SUPABASE_SECRET_KEY` (fichier non commité, jamais collée dans le chat,
  jamais dans `.env` de prod).
- **Agent** : agent-4 ensuite, pour prouver S2 sur le dev : `auth.admin.generateLink` →
  `hashed_token` → `verifyOtp({ token_hash, type })` → session `authenticated` ; utilisateur Auth
  de test supprimé après.
- **Critère de fin** : session obtenue et utilisateur de test supprimé, ou constat d'échec qui
  impose une autre voie de création de session.

### P1-5 — Edge Function `gis-login` + hook d'Auth (dev uniquement)
- **État 2026-11-18 (agent-4)** : migrations **écrites** :
  `supabase/migrations/0011_hook_identite_claims.sql` (table `t_auth_identity`, hook
  `custom_access_token_hook`, `fn_auth_identity_upsert`, fonctions `fn_jwt_*`) et
  `supabase/migrations/0012_tentatives_connexion.sql` (`t_login_attempts`,
  `fn_login_check_and_record`, `fn_login_unblock`), tests `supabase/tests/0011_*` et `0012_*`.
  Tests **21/21 et 13/13 sur un Postgres 13 local jetable** (bouchons des rôles et tables
  Supabase), **pas encore sur le dev** : l'accès SQL du MCP au projet dev échouait le 2026-11-18
  (`28P01 password authentication failed`). Restent : application et tests sur le dev,
  activation du hook sur le dev (geste utilisateur), Edge Function `gis-login` (passage suivant).
- **État 2026-11-18, P1-5c (agent-4) : Edge Function `gis-login` écrite, déployée sur le DEV seulement,
  testée.** Code : `supabase/functions/gis-login/index.ts` (Deno, `npm:@supabase/supabase-js@2.58.0`,
  `npm:bcryptjs@2.4.3` = même bibliothèque que le poste, C2). Déployée sur `ajadkziqaskadlzboeqo`
  (outil MCP `deploy_edge_function`, version 1, `verify_jwt = false` : l'appelant n'a pas encore de
  session, la clé publishable n'est pas un JWT ; l'authentification est le mot de passe + la limite
  0012). **Production : NON déployée.**
  - Entrée `POST {login, password}` (4 Ko au plus). Étapes : `fn_login_check_and_record('check')` →
    lecture `t_users` (clé secrète) → bcrypt dans la fonction (`$2a$`/`$2b$`/`$2y$` normalisés en
    `$2a$` ; login inconnu comparé à une empreinte factice, même durée) → échec = `'failure'` +
    **réponse 401 identique** (`invalid_credentials`) pour login inconnu, mauvais mot de passe, compte
    inactif, empreinte illisible ou `sync_id` inutilisable ; 429 `too_many_attempts` + `retry_after`
    (et en-tête `Retry-After`) quand le blocage est en cours ou vient d'être déclenché → succès =
    `'success'`, puis contrôles du site comme le poste (403 `no_site`, `site_suspended`,
    `licence_expired`, signalés seulement après un mot de passe juste ; SUPER ADMIN dispensé) →
    compte Auth miroir → `generateLink(magiclink)` → `fn_auth_identity_upsert` → réponse
    `{ok, token_hash, type: 'magiclink', user: {sync_id, primary_role, roles, is_super_admin}}`.
    Aucune session créée par la fonction (Q3) ; aucun hash, login ni jeton dans les journaux
    (codes d'événement seulement, vérifié dans `function_logs`).
  - **Compte Auth miroir (C7/C8)** : courriel technique `lower(sync_id)@users.gest-in-situ.invalid`
    (domaine réservé `.invalid`, aucun courriel réel, aucun envoi), confirmé d'office,
    `app_metadata.sync_id` ; créé à la première connexion, retrouvé ensuite par `t_auth_identity`
    (une personne = un compte Auth, vérifié en réel). `sync_id` accepté : `^[A-Za-z0-9_-]{1,64}$`.
  - **Clé** : `SUPABASE_SECRET_KEYS.default` (variable automatique de la fonction), sinon
    `SUPABASE_SERVICE_ROLE_KEY` ; jamais de fichier.
  - **CORS** : origines = variable `GIS_ALLOWED_ORIGINS` (liste séparée par des virgules) si définie,
    sinon `http://localhost:5173` et `http://localhost:4173` (serveurs de développement). Une origine
    non listée ne reçoit aucun `Access-Control-Allow-Origin`. Le poste Electron (processus principal,
    sans en-tête `Origin`) n'est pas concerné. **À définir avant la PWA** : l'origine réelle de la PWA
    dans `GIS_ALLOWED_ORIGINS` (geste utilisateur, Edge Functions > Secrets).
  - **Tests réels sur le dev (2026-11-18, tous conformes)** : OPTIONS origine autorisée 204 +
    en-têtes, origine non listée sans en-tête ; succès `$2a$` (opérateur avec site), `$2b$`
    (SUPER ADMIN sans site), `$2y$` ; `verifyOtp` fait côté client avec la clé publishable → session
    `authenticated`, 1 h, `app_metadata.sync_id` présent, **aucune claim `gis_*` (hook non activé,
    attendu)** ; `token_hash` rejoué → `otp_expired` (usage unique) ; 2e connexion → même compte
    Auth ; mauvais mot de passe / login inconnu / compte inactif → 401 au corps identique (durées
    433 / 434 / 451 ms) ; 5 échecs → 4 × 401 puis 429 `retry_after = 900` ; bon mot de passe pendant
    le blocage → 429 ; login inconnu : même séquence ; requête vide → 400 ; GET → 405 ; site suspendu
    → 403 `site_suspended` ; licence expirée → 403 `licence_expired`. Nettoyage prouvé par requête :
    0 compte Auth, session, jeton, ligne `t_auth_identity` / `t_login_attempts`, compte ou site de test.
  - **Non vérifié** : comportement avec le hook activé (claims `gis_*`, refus 403, D3 au
    `token_refresh`) ; charge réelle (bcrypt environ 0,4 s par appel ; limite CPU des Edge Functions
    non mesurée).
  - **Gestes restants (utilisateur)** : activer le hook sur le dev (Authentication > Hooks) puis
    rejouer les tests pour voir les claims ; fixer `GIS_ALLOWED_ORIGINS` quand l'origine PWA sera
    connue ; audit agent-9 ; déploiement prod de 0011/0012 + fonction + hook après P1-6.
- **Claims du hook** (liées à la personne, ids cloud) : `gis_v`, `gis_sync_id`, `gis_site_id`
  (`t_sites.id` cloud), `gis_site_sync_id`, `gis_centre_id`, `gis_centre_sync_id`,
  `gis_primary_role`, `gis_roles[]` (`t_users.role` ∪ `t_user_roles`), `gis_is_super_admin`,
  `gis_statut_actif`, `gis_last_online_login`. Refus 403 : identité inconnue, compte absent ou
  inactif (`statut_actif` ≠ 1, NULL compris), non-SA sans site cloud, dernière connexion en ligne
  de plus de 30 jours (D3, aussi au `token_refresh`). La date de connexion en ligne vient de
  `t_auth_identity.last_online_login_at`, écrite seulement par `gis-login` (service_role) ;
  `t_users.last_login` n'est pas utilisée (écrivable par la clé anon).
- **Fichiers** : `supabase/functions/gis-login/` ; migrations 0011 (hook custom access token,
  claims site/rôles/is_super_admin) et 0012 (comptage des tentatives) — détail : agent-1.
  (Numéros décalés de +1 le 2026-11-14 : 0010 est pris par `0010_lecture_versions_postes.sql`,
  écran « Versions des postes ».)
- **Agent** : agent-4 (fonction + migrations), agent-9 (audit sécurité avant prod).
- **Points corrigés** :
  - **Vérification du mot de passe** (C2) : bcrypt dans l'Edge Function (bcryptjs), qui accepte
    `$2a$`/`$2b$`/`$2y$`. Si une vérification SQL reste nécessaire : normaliser d'abord
    `$2b$`/`$2y$` → `$2a$` (`'$2a$' || substr(hash, 5)`) avant `extensions.crypt`.
  - Le hook refuse avec `{"error":{"http_code":403,…}}` (S3) et s'exécute aussi au `token_refresh`.
  - **S5 : tranché le 2026-11-18 (Q3)** — `verifyOtp` fait par le poste, limites inchangées.
    Texte d'origine : soit l'utilisateur relève les limites de débit Auth
    dans le tableau de bord (`/auth/v1/verify`, `/auth/v1/token`), soit la conception évite que
    toutes les vérifications partent de l'IP de l'Edge Function (ex. `verifyOtp` fait par le poste
    lui-même avec le `token_hash` reçu). Vérifier sur le dev quelle IP Auth voit derrière une Edge
    Function (non vérifié à ce jour).
- **Tests** : appels réels sur le dev (bon / mauvais mot de passe, compte désactivé, SA, hash
  `$2b$`), limite de tentatives, aucun hash dans les journaux de la fonction.
- **Critère de fin** : tests verts sur le dev, audit agent-9 GO, décision S5 prise.
- **Geste utilisateur** : décision S5 ; déploiement prod de la fonction et activation du hook
  (réglage Auth) **par l'utilisateur**, après P1-6.

### P1-6 — Politiques RESTRICTIVE TO authenticated (créées, dev puis prod)
- **Fichiers** : `supabase/migrations/0013_rls_restrictive_authenticated.sql` + test
  (ex-0012, décalé le 2026-11-14) ; nom réel retenu le 2026-11-18 :
  `0013_rls_authenticated_par_site.sql`.
- **Agent** : agent-4.
- **Contenu** : politiques RESTRICTIVE ciblant **uniquement** `authenticated` (filtre site/centre
  depuis les claims du hook). Aucune politique anon touchée en P1 (fermeture anon = P3).
- **Tests** : sur le dev aligné : un appel anon (clé publishable) continue de lire/écrire comme
  avant ; un appel `authenticated` d'un site ne voit pas un autre site ; `service_role` non filtré.
- **Critère de fin** : les trois cas vérifiés par appels réels sur le dev.
- **Geste utilisateur** : appliquer 0013 en prod (sans effet sur les postes actuels, cf. constat 7).
- **État 2026-11-18 (agent-4) : dev appliqué, prod NON.** Fichier réel :
  `supabase/migrations/0013_rls_authenticated_par_site.sql` (nom ajusté) + test
  `supabase/tests/0013_rls_authenticated_par_site.test.sql`.
  - Contenu : 14 politiques `r13_*` RESTRICTIVE TO authenticated, filtre **par site** (Q4) :
    `t_cartes`, `t_logs`, `t_user_presence`, `t_users` (colonne site directe), `t_user_roles`
    (site du compte), `t_postes` (site du centre) ; `t_sites` / `t_centres` lisibles par tout
    porteur des claims `gis_*` (annexe H), écriture par site. SUPER ADMIN : tous les sites.
    Échec fermé sans claims `gis_*`. `password_hash` illisible par authenticated (privilèges de
    colonne), écriture permise. TRUNCATE / TRIGGER / REFERENCES / MAINTAIN retirés à
    authenticated. Aucun droit ni politique anon touché.
  - Tests réels sur le dev (vrais `SET LOCAL ROLE`, claims simulées) : 0013 **19/19** (agent
    site A, agent site B, SA, authenticated sans claims, claims forgées sans `gis_v`, anon
    publishable et anon sans claims, service_role, garde 0007 toujours actif pour
    authenticated). Empreinte des droits anon identique avant / après (206 éléments).
    Non-régression : 0006 19/19, 0007 20/20, 0008 26/26, 0009 17/17, 0010 14/14, 0011 20/20
    (+ cas 20 non concluant comme avant), 0012 13/13. Aucun résidu (comptages et empreinte de
    `t_write_audit` identiques avant / après).
  - **Écart au critère de fin** : les trois cas sont vérifiés par SQL sous les vrais rôles
    PostgREST, **pas par appels REST réels** (aucune session authenticated réelle possible
    tant que le hook n'est pas activé ; activer le hook = geste utilisateur). Appel REST réel
    authenticated à faire après activation du hook sur le dev (via `gis-login` + `verifyOtp`).
  - Verrou mesuré : `CREATE POLICY` = `AccessExclusiveLock` (t_cartes compris) → prod hors
    heures de travail, bloc `BEGIN; … COMMIT;` (lock_timeout 3 s en tête).
  - Points pour P2 / P3 : voir README des migrations, section « 0013 ».
- **Complément 2026-11-18 (agent-4) : filtre par rôle, migration 0014. Dev appliqué, prod NON.**
  Fichiers : `supabase/migrations/0014_filtre_role_hierarchie.sql` + test
  `supabase/tests/0014_filtre_role_hierarchie.test.sql`.
  - Contenu : 9 politiques `r14_*` RESTRICTIVE TO authenticated (INSERT / UPDATE / DELETE) sur
    `t_sites` (SA seulement), `t_centres` et `t_postes` (SA ou `ADMINISTRATEUR_SITE` de son site),
    rôle lu dans `gis_roles` (principal + secondaires, comme `verifyUserRole()`). Lecture et anon
    inchangés. Prérequis 0011 et 0013 contrôlés en tête ; retour arrière en tête du fichier.
  - Tests réels sur le dev (vrais `SET LOCAL ROLE`, claims simulées) : 0014 **17/17** (SA, admin
    site A, admin site B, opérateur A, ADMIN_CENTRE A, multi-rôles, sans claims, claims forgées,
    anon publishable et sans claims, cascade, service_role concluant). Empreinte anon identique
    avant / après (206 éléments, même md5). Non-régression : 0006 19/19, 0007 20/20, 0008 26/26,
    0009 17/17, 0010 14/14, 0011 20/20 (+ cas 20 non concluant comme avant), 0012 13/13 ; 0013
    **15/19 tel quel** (écarts attendus dus à 0014 : son « agent A » opérateur ne crée plus de
    poste ni de centre et ne modifie plus son site ; détail dans le README) et **19/19** rejoué
    sans les politiques `r14_*` (retirées dans la même transaction annulée). Contrôles README 7/7.
    Aucun résidu (comptages, empreintes de `t_write_audit` et des politiques `r13_*` identiques
    avant / après).
  - **P1-6 complété sur le dev** (0013 + 0014). Restent : appel REST réel authenticated après
    activation du hook sur le dev (geste utilisateur) ; audit agent-9 ; prod (geste utilisateur).

### P1-7 — Brouillon P3 (fermeture anon), NON appliqué
- **Fichiers** : `supabase/migrations/brouillon_p3_fermeture_anon.sql` (non numéroté, en-tête
  « NE PAS APPLIQUER »).
- **À inscrire dans le brouillon (ajout du 2026-11-14)** : refermer la lecture des versions de
  postes ouverte par 0010. Dans `fn_list_client_versions()` et `fn_count_client_versions()`,
  ajouter un contrôle `public.fn_jwt_is_super_admin()` (refus sinon), puis :
  `REVOKE EXECUTE ON FUNCTION public.fn_list_client_versions() FROM anon;` et
  `REVOKE EXECUTE ON FUNCTION public.fn_count_client_versions() FROM anon;`
  (à faire dès que l'écran SUPER ADMIN lit avec une session `authenticated`, P2 au plus tard).
- **Agent** : agent-4.
- **Critère de fin** : fichier relu ; condition d'application écrite (**D6b** : tout le parc en
  version P2 à badge **et** 7 jours consécutifs sans aucune écriture anon — `publishable`,
  `legacy_suppose`, `autre` anon — d'après P1-1).

### P1-8 — Bilan et décision
- **Agent** : agent-9 (audit non-régression de l'ensemble P1).
- **Critère de fin** : rapport P0/P1/P2 ; `RELAIS.md` et `supabase/migrations/README.md` à jour.
- **Geste utilisateur** : valider le passage à P2 (client avec badge), qui exige l'adaptation de
  0007 (STOP & WARN).

## Ordre en production
1. 0008 (P1-1) + 0009 (P1-2) ensemble, dès validation dev. Puis laisser collecter (P1-1b).
2. P1-3 lecture seule.
3. 0011/0012/0013 et la fonction `gis-login` seulement après P1-4, P1-5 (décision S5) et P1-6
   validés sur le dev.
4. D6a (désactivation de l'ancienne clé anon legacy) : sur décision de l'utilisateur, d'après
   P1-1b. D6b (fermeture anon) : P3, après P2.
5. 0014 (filtre par rôle, D-R) : avec 0013, dans la même fenêtre hors heures de travail (0014 après 0013).
6. 0015 (adaptation du garde 0007, Q6) : avant P2.

## Changements par rapport au plan initial d'agent-1
- Ajout de P1-A (alignement dev, fait) et des écarts de schéma restants.
- Mesure par **forme des claims** au lieu du préfixe de clé ; sous-étape de preuve P1-1b.
- Trois triggers STATEMENT (INSERT, UPDATE, DELETE) au lieu d'un, tables de transition vides
  ignorées, compteur agrégé au lieu d'une ligne par appel.
- Normalisation `$2b$`/`$2y$` → `$2a$`, ou bcrypt dans l'Edge Function (C2).
- Prérequis explicite `SUPABASE_SECRET_KEY` du dev (P1-4) avant P1-5.
- Décision S5 (limites de débit Auth) obligatoire avant la prod de P1-5.
- Preuve écrite que RESTRICTIVE TO authenticated n'affecte pas anon en prod.
- Ordre prod : P1-1 + P1-2 d'abord.
- Numérotation des fichiers 0008-0012 proposée ici ; à réconcilier avec le découpage d'agent-1
  (annexe B). **Mise à jour 2026-11-14** : 0010 attribué à l'écran « Versions des postes »
  (`0010_lecture_versions_postes.sql`) ; les fichiers non écrits du chantier B deviennent 0011
  (hook), 0012 (tentatives), 0013 (RLS restrictives). Les numéros de l'annexe B sont ceux
  d'origine d'agent-1, non renumérotés.

---

## Annexe A — Choix techniques C1-C10 (rapport agent-1 du 2026-11-13, recommandations retenues)

| # | Question | Recommandation retenue |
|---|---|---|
| C1 | Où vit `login` | **Edge Function**. Une fonction SQL ne peut pas créer de session Auth sans garder la clé de signature dans la base (refusé). La limite de tentatives reste en SQL, appelée par la fonction. |
| C2 | Vérification du bcrypt | **Dans l'Edge Function** (bcryptjs, même bibliothèque que le poste, quel que soit le préfixe). |
| C3 | Création de la session | **`generateLink` puis `verifyOtp` côté serveur** si S2 est prouvé ; sinon mot de passe aléatoire réécrit à chaque connexion puis `signInWithPassword`. Déconseillé : importer le bcrypt dans `auth.users` (deux sources de vérité, pas de limite de tentatives à nous). |
| C4 | Stockage de l'empreinte | **Reste dans `t_users.password_hash`**, source unique. En P2, descente des empreintes par `fn_site_user_hashes` (D1 : jamais celles d'un SA) ; en P3, retrait de la lecture anon de la colonne. |
| C5 | Limite de tentatives | **Par login** : 5 échecs → 15 min, puis doublement, plafond 24 h, déblocage par un SA. Pas de blocage par IP seule (plusieurs postes derrière la même IP). |
| C6 | Durée des jetons | **1 h** (défaut). La règle des 30 jours sans connexion en ligne (D3) est appliquée par le client (expiration du badge) et par le hook (refus si dernière connexion en ligne > 30 jours). Ne pas compter sur les limites de session Auth (peut-être payantes, non vérifié). |
| C7 | Adresse du compte miroir | **`<sync_id>@users.gest-in-situ.invalid`**, confirmée d'office ; aucun courriel réel, aucun envoi. |
| C8 | Création des comptes miroirs | **À la première connexion** (pas de script avec un secret, pas de comptes inutilisés). |
| C9 | Outillage | **Pas de Supabase CLI pour P1** ; code source suivi dans `supabase/functions/`, déploiement par le tableau de bord ou l'outil MCP. Ajouter une dépendance demande l'accord de l'utilisateur. |
| C10 | Granularité de `poste_key` dans la mesure | Accepter « inconnu » en P1 ; seule la classe de clé compte pour D6 et la vieille clé. |

## Annexe B — Découpage d'origine d'agent-1 (pour réconciliation)

Objets côté Supabase proposés par agent-1 : A `t_write_metrics` + interrupteur ; B triggers de
mesure sur 8 tables ; C `t_client_versions` + RPC `fn_report_client_version` (SECURITY DEFINER,
ouverte à anon/authenticated, table illisible) ; D `t_auth_identity` (auth_user_id → user_sync_id) ;
E `t_login_attempts` + `fn_login_check_and_record` (EXECUTE réservé à service_role) ; F hook
`custom_access_token_hook` (claims `gis_sync_id`, `gis_site_id`, `gis_centre_id`, `gis_roles[]`,
`gis_is_super_admin`, `gis_statut_actif`) ; G fonctions `fn_jwt_site_id()`, `fn_jwt_is_super_admin()`,
`fn_jwt_roles()` ; H politiques RESTRICTIVE TO authenticated (t_sites et t_centres lisibles par tout
authentifié) ; I `fn_site_user_hashes()` ; J Edge Function `gis-login` ; K brouillon P3.

Étapes d'origine : P1-0 essais ; P1-1 mesure (0008) ; P1-2 versions (0009) ; P1-3 identité et
tentatives (0010) ; P1-4 hook (0011) ; P1-5 Edge Function ; P1-6 RLS restrictives (0012) + audit
agent-9 ; P1-7 diagnostic site/centre ; P1-8 brouillon P3 ; P1-9 documentation. Modèle conseillé :
Opus pour essais, hook et RLS ; Sonnet suffit pour mesure, versions, tentatives, diagnostic, doc.

Risques de régression listés par agent-1 (à reprendre dans chaque test) : trigger de mesure qui
lèverait une erreur (outbox qui réessaie sans fin) → `EXCEPTION WHEN others` + interrupteur ;
ralentissement des gros envois → comptage par instruction ; contention sur la ligne de compteur ;
politique RESTRICTIVE qui viserait anon par erreur → `TO authenticated` explicite + comparaison
anon avant/après ; verrou long sur `t_cartes` → aucune colonne ajoutée aux tables métier, application
hors heures de travail ; RPC de version ouverte à anon → paramètres bornés, une ligne par poste.
