# Plan P1 du chantier B — version corrigée (2026-11-13)

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
| 0007 | **STOP & WARN maintenu** : le garde 0007 neutralise les gestes SA faits avec la clé anon. Il devra être adapté (laisser passer un appelant `authenticated` légitime) **avant P2**, pas en P1. Ne pas le modifier pendant P1. |
| Ordre en prod | **P1-1 (mesure) et P1-2 (versions) d'abord**, seuls, pour commencer à collecter. Le reste suit après validation sur le dev. |
| Ancienne clé anon prod | Désactivation dès que la mesure P1-1 montre zéro écriture « legacy » pendant 7 jours (D6) **et** que tout le parc est en ≥ 2.26.1. Geste de l'utilisateur. |

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

### P1-1 — Mesure des écritures par type de clé (dev puis prod) — FAIT SUR LE DEV (2026-11-13)
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
- **Reste** : application en prod (geste utilisateur), puis P1-1b.
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
  - Classement : `role='anon' AND NOT (claims ? 'iss')` → `publishable` ;
    `role='anon' AND claims ?& array['iss','ref','iat','exp']` → `legacy_suppose`.
- **Tests (dev)** : test SQL en transaction annulée (claims simulées : publishable, JWT legacy
  simulé, authenticated, service_role, postgres sans claims ; upsert à 0 ligne ; DELETE ; aucune
  valeur de claim stockée) ; appel REST réel avec la clé publishable du dev → une ligne
  `publishable` ; mesure du surcoût sur un upsert de 500 cartes (comparaison avec/sans triggers).
- **Critère de fin** : test SQL tout vert, appel réel classé `publishable`, surcoût mesuré et
  jugé acceptable, objets de test supprimés.
- **Geste utilisateur** : appliquer 0008 en prod (SQL Editor) après validation dev.

### P1-1b — Preuve en prod de la forme des claims « legacy » (sous-étape de P1-1)
- **But** : prouver le discriminant du constat 2 sans lire aucune clé.
- **Moyen** : 0008 elle-même suffit (elle enregistre role + liste des noms de clés + x-client-info).
  Pendant que le parc tourne encore sur l'ancienne clé, les postes en version < 2.26.1 doivent
  apparaître en `legacy_suppose` et les postes ≥ 2.26.1 en `publishable`.
- **Agent** : agent-4 (lecture des compteurs agrégés, lecture seule, avec accord).
- **Critère de fin** : au moins un compteur `legacy_suppose` **et** un compteur `publishable`
  observés en prod, ou constat explicite qu'aucun poste n'utilise plus l'ancienne clé. Si la forme
  réelle diffère (ex. claims legacy sans `iss`), corriger le classement avant toute décision.
- **Geste utilisateur** : laisser tourner ; autoriser la lecture des compteurs.

### P1-2 — Table des versions de postes (dev puis prod) — FAIT SUR LE DEV (2026-11-13)
- **Résultat dev (agent-4)** : 0009 appliquée sur le dev ; test SQL **14/14** (paramètres
  bornés, une ligne par poste, plafond 5000 postes, classe de clé calculée côté serveur, table
  illisible et non modifiable par anon). Appel REST réel `fn_report_client_version` avec la clé
  publishable : `true`, ligne `key_kind = publishable` ; appel invalide : `false` sans erreur ;
  SELECT et INSERT directs sur `t_client_versions` par anon : refusés (42501). Ligne de test
  supprimée. Aucun appel côté poste (P2).
- **Fichiers** : `supabase/migrations/0009_versions_postes.sql` + test (contenu : agent-1).
- **Agent** : agent-4.
- **But** : savoir quels postes tournent encore une version qui utilise l'ancienne clé, avant D6.
- **Tests** : test SQL transaction annulée ; écriture réelle avec la clé publishable du dev.
- **Critère de fin** : test vert ; en prod, lecture possible par l'utilisateur.
- **Geste utilisateur** : appliquer 0009 en prod avec 0008 (même fenêtre).

### P1-3 — Diagnostic site/centre (dev, lecture seule en prod)
- **Fichiers** : requêtes de diagnostic (agent-1), pas de migration si lecture seule.
- **Agent** : agent-4.
- **Lien** : bogue connu « site_id local envoyé au cloud » (mémoire 2026-10-27), à mesurer avant
  d'écrire des politiques filtrées par site.
- **Critère de fin** : liste des comptes/cartes dont le site cloud est incohérent, sans données
  personnelles dans le rapport.
- **Geste utilisateur** : autoriser la lecture prod.

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
- **Fichiers** : `supabase/functions/gis-login/` ; migrations 0010 (hook custom access token,
  claims site/rôles/is_super_admin) et 0011 (comptage des tentatives) — détail : agent-1.
- **Agent** : agent-4 (fonction + migrations), agent-9 (audit sécurité avant prod).
- **Points corrigés** :
  - **Vérification du mot de passe** (C2) : bcrypt dans l'Edge Function (bcryptjs), qui accepte
    `$2a$`/`$2b$`/`$2y$`. Si une vérification SQL reste nécessaire : normaliser d'abord
    `$2b$`/`$2y$` → `$2a$` (`'$2a$' || substr(hash, 5)`) avant `extensions.crypt`.
  - Le hook refuse avec `{"error":{"http_code":403,…}}` (S3) et s'exécute aussi au `token_refresh`.
  - **S5, décision requise avant la prod** : soit l'utilisateur relève les limites de débit Auth
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
- **Fichiers** : `supabase/migrations/0012_rls_restrictive_authenticated.sql` + test.
- **Agent** : agent-4.
- **Contenu** : politiques RESTRICTIVE ciblant **uniquement** `authenticated` (filtre site/centre
  depuis les claims du hook). Aucune politique anon touchée en P1 (fermeture anon = P3).
- **Tests** : sur le dev aligné : un appel anon (clé publishable) continue de lire/écrire comme
  avant ; un appel `authenticated` d'un site ne voit pas un autre site ; `service_role` non filtré.
- **Critère de fin** : les trois cas vérifiés par appels réels sur le dev.
- **Geste utilisateur** : appliquer 0012 en prod (sans effet sur les postes actuels, cf. constat 7).

### P1-7 — Brouillon P3 (fermeture anon), NON appliqué
- **Fichiers** : `supabase/migrations/brouillon_p3_fermeture_anon.sql` (non numéroté, en-tête
  « NE PAS APPLIQUER »).
- **Agent** : agent-4.
- **Critère de fin** : fichier relu ; condition d'application écrite (D6 : 7 jours sans écriture
  `publishable`/`legacy_suppose` d'après P1-1, tout le parc en version à badge).

### P1-8 — Bilan et décision
- **Agent** : agent-9 (audit non-régression de l'ensemble P1).
- **Critère de fin** : rapport P0/P1/P2 ; `RELAIS.md` et `supabase/migrations/README.md` à jour.
- **Geste utilisateur** : valider le passage à P2 (client avec badge), qui exige l'adaptation de
  0007 (STOP & WARN).

## Ordre en production
1. 0008 (P1-1) + 0009 (P1-2) ensemble, dès validation dev. Puis laisser collecter (P1-1b).
2. P1-3 lecture seule.
3. 0010/0011/0012 et la fonction `gis-login` seulement après P1-4, P1-5 (décision S5) et P1-6
   validés sur le dev.
4. Désactivation de l'ancienne clé anon : sur décision de l'utilisateur, d'après P1-1b.

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
  (annexe B).

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
