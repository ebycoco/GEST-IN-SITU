# GEST-IN-SITU — Version téléphone v1 (OPERATEUR_VERIFICATION)

Plan établi le 2026-11-23 par agent-1-architect-pm (lecture seule), vérifié par la session
principale ; **8 décisions validées par l'utilisateur le 2026-11-23 (« Oui, toutes »)**.

## Besoin
- Rôle unique : `OPERATEUR_VERIFICATION` (délivrance des cartes CMU).
- Sur téléphone : connexion avec son identifiant personnel, recherche / consultation d'une carte,
  enregistrement du retrait.
- **Internet obligatoire** (décision utilisateur) : aucun mode hors ligne, aucune base locale.

## Constats vérifiés
- Retrait Windows : `cartes:delivrer` (`src/main/ipc/handlers.ts:1449`) → `delivrerCarte`
  (`src/main/database/queries/cartes.queries.ts:673-839`) : seule une carte `EN STOCK` est
  délivrable ; même site ; même centre sauf carte non classée (rangement d'urgence alors
  obligatoire) ; refus `DOUBLON` / `DELIVRE` (l.700-727). Le serveur ne contrôle pas
  `statut_physique` (ABSENT / PERDUE).
- Réception par les postes : une carte sans modification en attente est mise à jour si
  `updated_at` du cloud est strictement plus récent (`src/main/workers/download-worker.js:325-327`) ;
  avec une modification en attente, le statut plus avancé est adopté (`:279-322`).
  Garde cloud 0006 : première délivrance gagnante, conflit journalisé dans `t_sync_conflicts`.
- **P0 avant ouverture** : `r13_t_cartes_site` (`supabase/migrations/0013_rls_authenticated_par_site.sql:177-183`)
  laisse tout utilisateur `authenticated` lire et écrire toutes les colonnes des cartes de son
  site (aucun filtre par rôle). Sans effet tant qu'aucune session personnelle n'existe en prod.

## Décisions (2026-11-23)
| # | Décision |
|---|---|
| Q1 | Retrait par **fonction serveur** atomique (RPC `SECURITY DEFINER`), pas d'écriture directe ni de validation par un poste |
| Q2 | **Fermer** pour `authenticated` non-admin les écritures directes **et** la lecture directe de `t_cartes` (et l'écriture de `t_logs`) ; recherche et retrait uniquement par fonctions |
| Q3 | v1 réservée au rôle `OPERATEUR_VERIFICATION` |
| Q4 | Verrou d'inactivité 15 min, bouton « Se déconnecter » toujours visible |
| Q5 | Refus côté serveur d'une carte `ABSENT` / `PERDUE` (téléphone seulement ; aligner Windows = autre chantier) |
| Q6 | Jamais de `num_secu` ; contact de l'assuré masqué sauf les 2 derniers chiffres |
| Q7 | Web app installable (PWA) Vite + React + TypeScript, hébergement statique gratuit (Cloudflare Pages ou équivalent), service worker sans cache de données ni `backgroundSync` |
| Q8 | Production : pilote 1 centre, 1-2 opérateurs, après règlement du quota Supabase et réparation des `site_id` / `centre_id` du cloud |

**Décision du 2026-11-23 (conflit 0019 / P2)** : 0019 ferme `t_cartes` (dont
`fn_downstream_cartes_chunk`, SECURITY INVOKER) et l'écriture de `t_logs` à toute session
`authenticated` d'opérateur. Choix de l'utilisateur : **la synchronisation des cartes des postes
reste sur l'accès partagé (anon / publishable) jusqu'à P3** ; le poste à badge de P2 n'utilise la
session personnelle que pour l'identité, pas pour synchroniser `t_cartes` / `t_logs` d'un
opérateur. À reprendre au moment de P3 (fermeture anon) : fonctions dédiées de synchronisation.

## Fonctions serveur prévues (migration 0020)
- `fn_mobile_rechercher_cartes(p_nom, p_ddn, p_tel)` : critères (nom + date de naissance) ou
  téléphone 10 chiffres ; site du jeton ; 10 lignes max, centre de l'opérateur d'abord ; colonnes
  réduites, contact masqué, jamais `num_secu` ; journal `VERIFICATION_RECHERCHE`. Performance à
  mesurer (`EXPLAIN`) ; un index sur `t_cartes` serait un changement de schéma (STOP & WARN).
- `fn_mobile_delivrer_carte(p_sync_id, p_type_retirant, p_nom_retirant, p_tel_retirant,
  p_rangement_urgence, p_request_id)` : identité depuis `fn_jwt_*` + relecture de
  `t_users.statut_actif` ; `SELECT ... FOR UPDATE` ; contrôles de `delivrerCarte` + Q5 ;
  date, agent (`t_users.login`), centre de retrait et `id_centre` recalculé (préfixe le plus long)
  posés par le serveur ; `updated_at = GREATEST(now(), OLD.updated_at + 1 ms)` ; journal
  `CARTE_DELIVREE` (`canal: MOBILE`) ; codes de retour `OK`, `DEJA_DELIVREE`, `DOUBLON`,
  `HORS_CENTRE`, `HORS_SITE`, `STATUT_INVALIDE`, `RANGEMENT_REQUIS`, `ABSENTE`, `COMPTE_INACTIF`.
- `EXECUTE` à `authenticated` seulement ; `REVOKE` PUBLIC et anon.

## Étapes
| # | Contenu | Agent | Dépend de |
|---|---|---|---|
| E1 | Maquettes des 6 écrans (connexion, recherche, liste, fiche, délivrance, résultat), 360 px, plein soleil | agent-2-designer | — |
| E2 | Migration 0019 : fermeture lecture / écriture directes `authenticated` non-admin sur `t_cartes` (+ écriture `t_logs`), **dev** ; empreinte anon identique | agent-4-db-sync | — |
| E3 | Migration 0020 : les deux fonctions + tests SQL (course, hors centre, non classée, DOUBLON, ABSENT, compte inactif, jeton sans claims, réessai), **dev** | agent-4-db-sync | E2 |
| E4 | Un poste (dev, `.env.e2e`) reçoit bien un retrait fait par la fonction | agent-13-qa-terrain-tester | E3 |
| E5 | Client `mobile/` (nouveau dossier, aucun fichier `src/` touché, pas d'import de `src/shared`) branché sur le dev ; dépendances soumises à accord | agent-3-coder (+ agent-2) | E1, E3 |
| E6 | Audit sécurité / non-régression | agent-9-senior-auditor | E5 |
| E7 | Test vivant largeur téléphone (dont double tentative) | agent-13-qa-terrain-tester | E6 |
| E8 | Hébergement + `GIS_ALLOWED_ORIGINS` (dev) ; essai sur un vrai téléphone | session principale + utilisateur | E5 |
| E9 | Ouverture en prod (pilote Q8) après GO agent-12 | utilisateur | E7 + prérequis prod |

**Prérequis prod** : 0013-0018 appliquées ; hook activé et `gis-login` v3 déployée ; inscriptions
Auth prod coupées ; réparation `id_site` / `id_centre` du cloud ; alerte saturation et coût ;
quota Supabase réglé (restriction annoncée au 2026-12-18) ; 0019 et 0020.

## E4 — un poste reçoit le retrait du téléphone (agent-13, dev, 2026-11-24) : FAIT
Run final 27/27 contrôles, `5 passed` (spec `_agent13_retrait_mobile_20261123.cloud.e2e.spec.ts`,
non commitée). Dev nettoyé (vérifié par la session principale).
- Carte sans modification locale : reçue DELIVRE au cycle suivant (14 s), preuve de retrait
  affichée avec l'agent téléphone. Avec modification locale en attente : statut adopté, contact
  local gardé, cloud reste DELIVRE. Double délivrance (poste hors ligne + téléphone) : la
  première arrivée au cloud gagne (0006, motif `STATUT_EVT_PLUS_ANCIEN`), le poste s'aligne.
- **À régler avant le pilote** :
  - **P1-1** : la réception automatique est **désactivée par défaut** (`auto_downstream_<id_user>`
    absent → pas de minuterie, `src/main/ipc/handlers.ts:333-336`) : sans elle, le poste ne
    reçoit pas le retrait et propose encore « Procéder au Retrait ».
  - **P1-2** : le conflit de double délivrance est invisible pour l'opérateur du poste (aucune
    alerte ; deux journaux `CARTE_DELIVREE` pour la même carte dans le cloud).
  - **P1-3** (antérieur) : compteurs « retraits du jour » à égalité stricte sur
    `date_delivrance` (`src/main/database/queries/stats.queries.ts:196`, `:1496`, et selon
    agent-13 `:1280`, `:1355`) → 0 pour des dates horodatées (déjà noté « KPI figés », reporté).
  - Journaux `CARTE_DELIVREE` du téléphone : reçus seulement au cycle long (toutes les 2 h).

## P1-1 et P1-2 corrigés (2026-11-24)
- Commits `ef4d0d7` (agent-4) puis `22fe5f8` (correctifs P2-1 à P2-4 de l'audit agent-9, aucun
  P0/P1) : réception automatique par défaut pour le rôle actif `OPERATEUR_VERIFICATION` (choix
  explicite respecté, réévaluée au changement de rôle) ; alerte locale « Retrait non retenu »
  (`t_logs` `ALERTE_DOUBLE_DELIVRANCE`, non synchronisée, bannière + acquittement, rôles qui
  délivrent, portée site, seulement si la remise est postérieure au `synced_at` local).
- Test vivant agent-13 (dev, 68/69, l'échec vient de la spec) : carte du téléphone reçue en ~50 s
  sans action ; préférence `false` respectée ; bascule de rôle démarre/arrête la réception ; vraie
  double délivrance → une alerte, bannière, acquittement tracé, rien dans le cloud ; pas d'alerte
  sur un renvoi ordinaire ni pour OPERATEUR_QUALITE. 1366x768 : bannière 95 px (1 alerte) / 142 px
  (2). ~49 requêtes cloud en 5 min par poste inactif. Dev nettoyé (vérifié par la session
  principale ; `t_write_audit` 32 conservé, compteur de mesure).
- Restent (P2) : toast qui masque le bouton de la bannière ~8 s ; bannière à 2 alertes qui pousse
  « Rechercher la Carte » sous le pli à 1366x768 ; cycle court qui retélécharge les mêmes cartes
  à chaque passage (cause non établie, curseur ?) ; journaux `CARTE_DELIVREE` du poste écarté
  gardés dans le cloud. Non testés en vrai : copie périmée avec date différente (P2-1), conflit
  par le worker d'envoi en masse, émargement rétroactif.

- Commit `d6487fe` (agent-4 + agent-2) : fin du retéléchargement en boucle du cycle court
  (comptage léger depuis `last_downstream_sync_true`, défaut présent depuis `12dea6f`) et bande
  d'alerte compacte (44 px, panneau superposé, toast en bas au centre). Test vivant agent-13
  (dev, 49/49) : 0 pull ciblé et 0 `fn_downstream_cartes_chunk` sur 390 s d'inactivité ; carte
  du téléphone reçue en 44 s ; requêtes du processus principal sur 5 min 39 → 20 ; « Rechercher
  la Carte » au-dessus du pli avec 1 ou 2 alertes ; panneau clic/clavier/Échap OK ; acquittement
  OK ; rien pour OPERATEUR_QUALITE. Dev nettoyé (vérifié). Restent (P2) : toasts d'autres écrans
  en haut à droite qui couvrent « Voir » quelques secondes ; toast d'alerte pouvant chevaucher
  « Rechercher la Carte » si une ligne « Synchroniser mes actions » s'affiche en plus.

## E5 à E7 — client téléphone (2026-11-24)
- **E5** (agent-3, `e757aa2`) : dossier `mobile/` (Vite 5, React 19, supabase-js 2), session en
  mémoire seulement, verrou 15 min = reconnexion, service worker sans cache de données.
- **E6** (agent-9) : aucun P0 ; GO avec réserves pour le dev, NO-GO pilote prod en l'état
  (0019/0020 non appliquées en prod, hébergement : `GIS_ALLOWED_ORIGINS` exact + CSP + en-têtes,
  prérequis Q8). Six correctifs faits (agent-3, `99e0784`) : autocomplete off/new-password +
  consigne `mobile/README.md`, réponses tardives ignorées, écran effacé avant fermeture, bon
  retirant sur le succès, délai 30 s, COMPTE_INACTIF déconnecte.
- **E7** (agent-13, dev, 360 px, 78/81 contrôles, aucun P0/P1) : connexion réelle, refus de rôle,
  compte désactivé, aucun stockage navigateur hors coquille ; recherches, masquage, délivrances
  assuré/tiers vérifiées en base ; tous les refus (fiche et course) ; triple clic = 1 écriture ;
  coupure réseau → « Vérifier » → même `request_id`, 1 écriture ; deux opérateurs = 1 OK + 1
  DEJA_DELIVREE ; verrou (horloge simulée), autre identifiant refusé, réponses tardives ignorées.
  Dev nettoyé (vérifié par la session principale).
- **Restent (P2)** : boucle « Rangement d'urgence obligatoire » si une carte est déclassée entre la
  recherche et la confirmation ; jeton d'accès valable jusqu'à expiration après déconnexion
  (normal, durée à fixer en prod) ; `num_retirant` au format brut pour l'assuré (hétérogène) ; lieu
  de naissance absent de la liste des homonymes ; message trompeur au déverrouillage par un autre
  compte. Vrai logo mis en place ensuite (agent-8 : écran de connexion + icônes d'installation
  tirées de `resources/icon.png`, roue et mire remplies en blanc côté téléphone seulement ; le logo
  maître garde une roue transparente, non modifié). Non testés : Chrome Android réel
  (enregistrement du mot de passe), poste Windows (déjà fait en E4).

## Non vérifié
Vitesse de la recherche ; offres gratuites des hébergeurs ; coût en quota ; stockage de session
par défaut de supabase-js ; usage actuel de `retrait:validerRetrait` ; type `magiclink` de
`verifyOtp` déprécié dans supabase-js (fonctionne encore, à surveiller).
