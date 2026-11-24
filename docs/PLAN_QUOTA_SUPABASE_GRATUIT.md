# GEST-IN-SITU — Rester sur l'offre Supabase gratuite (plan du 2026-11-24)

Décision utilisateur (2026-11-24) : **rester sur l'offre gratuite** (egress 5 Go / cycle, base
0,5 Go / projet). Plan établi par agent-4-db-sync en **lecture seule**, contrôlé par la session
principale (version publiée v2.27.1, constantes `sync-engine.ts:57-59`).

## Constat
- Cycle 18/10-18/11 : egress 5,668 Go → période de grâce jusqu'au **18/12/2026** (ensuite
  réponses 402, postes coupés si nouveau dépassement). Cycle en cours : 1,148 Go en 6 jours,
  dépassement prévu vers le 13-16/12 au rythme actuel.
- **Cause principale : rattrapage horaire `cards-reconcile.ts`** (sorti en v2.24.1, le
  18/10/2026) : liste de tous les `sync_id` du site (223 pages de 1 000), ~4,3 Mo gzip par
  passage et par poste, ~42 passages/jour mesurés dans les journaux edge (~178 Mo/jour).
- Boucle du cycle court (corrigée par `d6487fe`, non publiée) : encore active en prod
  (1 617 appels `fn_downstream_cartes_chunk` en 24 h).
- Base prod 368 Mo : `t_cartes` 353 Mo dont **221 Mo d'index** (plusieurs jamais utilisés,
  un doublon, deux gonflés).

## Estimation mensuelle (egress compté compressé, hypothèse cohérente avec la mesure)
| Scénario | Go / mois |
|---|---|
| Actuel (v2.27.1) | ≈ 5,7 |
| Publier `ef4d0d7` + `d6487fe` tels quels | **≈ 11** |
| Même publication + **R1** (rattrapage 1×/jour/poste) | ≈ 1,8-2,2 |
| + pilote téléphone (1 centre) | + ≈ 0,1 |

## Plan retenu (proposé, chaque étape soumise à l'accord de l'utilisateur)
1. **Sans code, tout de suite** : désactiver « Récupération automatique » (Profil) sur les
   postes qui n'en ont pas besoin d'ici la release.
2. **Bloquant avant la release Windows** : **R1** — rattrapage au plus une fois par jour et par
   poste (date du dernier passage réussi dans `t_config`, par site ; `sync-engine.ts:57-59`,
   `:283`, `:1107`, `:1148`), livré avec `ef4d0d7` et `d6487fe`. **Ne jamais publier `ef4d0d7`
   sans R1.** Effet : une carte manquée par le curseur est rattrapée en 24 h au lieu de 1 h ;
   les retraits téléphone passent par le cycle court (≤ 75 s), non concernés.
3. **Prod, indépendant de la release** : migration 0021 groupe 1 — suppression de
   `idx_cartes_sync_id` (doublon de `t_cartes_sync_id_key`), `idx_cartes_cle_flex`,
   `idx_cartes_prenoms`, `idx_cartes_contact`, `idx_cartes_statut`, `idx_cartes_statut_phys`,
   `idx_cartes_rangement` (≈ −77 Mo ; aucune donnée supprimée ; une instruction
   `DROP INDEX CONCURRENTLY` par exécution) ; `REINDEX INDEX CONCURRENTLY` de
   `idx_cartes_site_updated_syncid` et `t_cartes_sync_id_key` (≈ −35 Mo). Base ≈ 255 Mo.
   Groupe 2 (`idx_cartes_cle_doublon`, `idx_cartes_site_statut`, `idx_cartes_num_secu`,
   `idx_cartes_sync`, ≈ −43 Mo) après 7 jours d'observation des compteurs.
4. **Plus tard** : R2 (rattrapage par empreintes de groupes, ≈ 10-20 Ko par passage) ; réglages
   facultatifs (ping 60 s, cycle comptes) ; étaler les réinstallations de postes (≈ 60-110 Mo
   chacune).

## Réalisé (2026-11-24)
- **0021 en prod** (`406616c`) : base 368 → 253 Mo, aucune donnée touchée.
- **R1** (`8ea51a3`) puis correctifs d'audit agent-9 (`1bfd3f9`) : rattrapage au plus 1×/22 h
  par poste et par site, date future (> +5 min) ignorée, essais 1 h → 8 h. Test vivant agent-13
  (dev) : premier passage ~2,5 min après connexion, aucun nouveau passage après déconnexion,
  changement de rôle, bascule de la préférence ou coupure réseau ; carte supprimée localement
  récupérée ; date future ignorée ; échec → +1 h ; retrait téléphone reçu en ~50 s, sans boucle.
  Restent (P2) : nouvelle tentative intégrée à postgrest-js (jusqu'à 4 requêtes par page en
  échec réseau, `.retry(false)` possible) ; une page vide en fin de parcours.
- À publier dans la prochaine version Windows (avec `ef4d0d7`, `d6487fe`).

## Non vérifié
Comptage exact de l'egress par Supabase (compressé, en-têtes) ; correspondance IP ↔ poste ;
taux de compression des lignes de cartes ; `fetch` intégré à Electron ; date de remise à zéro
des compteurs d'index. À noter aussi : `fn_mobile_rechercher_cartes` ≈ 6,9 s en prod (aucun
index utile) — à traiter séparément.
