---
name: moteur-sync-offline-first
description: Documente le "quadriptyque transactionnel" obligatoire pour toute mutation de carte/événement métier dans GEST-IN-SITU (transaction SQLite + is_dirty=1 + t_logs + t_outbox), la capture dual-track, la résolution Last-Write-Wins (LWW), et le principe d'invariabilité des schémas. À charger avant toute écriture SQL touchant t_cartes ou tout écrit devant se propager vers Supabase (agent-4-db-sync, ou agent-3-coder pour un correctif de requête).
---

# Moteur de synchronisation offline-first — GEST-IN-SITU

Référence technique du moteur SQLite (local) → Supabase (cloud) de
GEST-IN-SITU : offline-first, machine à états, isolation par site/centre.

## Le quadriptyque transactionnel (obligatoire, sans exception)

Toute mutation de carte ou d'événement métier doit être enveloppée dans une
**transaction SQLite unique** (`db.transaction()`) qui accomplit les 4
actions suivantes de façon atomique :

1. **Modification de la table concernée** (ex: `UPDATE t_cartes SET ...`).
2. **`is_dirty = 1`** sur la ligne modifiée — marque la ligne comme
   "à synchroniser" pour le cycle amont.
3. **Insertion dans `t_logs`** — trace d'audit et source de notifications
   temps réel (ex: `CARTE_ABSENTE_SIGNALEE`, `CARTE_PERDUE_CONFIRMEE`).
4. **Capture dans `t_outbox`** via `enqueueOutbox(sync_id, table, action,
   payload)` — file d'attente de propagation vers Supabase.

Si l'une de ces 4 actions manque, la mutation reste incohérente : soit elle
n'est jamais synchronisée (oubli `t_outbox`), soit elle n'apparaît jamais
dans l'historique (oubli `t_logs`), soit le cycle amont ne la détecte jamais
(oubli `is_dirty`).

### Piège fréquent : payload minimal vs payload complet

`outbox.service.ts` applique `mapCardPayload()` au moment de l'envoi, qui
exige un objet carte complet (notamment `site_id`). Un payload minimal
(ex: `{ sync_id }` seul) fait échouer systématiquement cette validation
("site_id manquant"), et l'entrée outbox part en `ERROR` définitif sans
jamais atteindre Supabase — bug déjà rencontré sur ce pattern précis dans
`delivrerCarte()` (`cartes.queries.ts`) et reproduit ensuite dans
`signalerAbsence()`/`resoudreAbsence()`/`declarerPerdue()`/`reactiverCarte()`
(`absence.queries.ts`) avant correction. Toujours relire la carte complète
(`SELECT * FROM t_cartes WHERE id_carte = ?`) juste avant `enqueueOutbox`,
pas seulement les colonnes modifiées.

### Exemple réel du pattern complet

```ts
// src/main/database/queries/absence.queries.ts — signalerAbsence()
return db.transaction(() => {
  // 1. Modification de la table
  db.prepare(query).run(params); // UPDATE t_cartes SET statut_physique = 'ABSENT', ..., is_dirty = 1

  // 3. Insertion t_logs
  db.prepare(`INSERT INTO t_logs (...) VALUES (...)`).run(...);

  // 4. Capture t_outbox (payload complet, pas minimal)
  if (card.sync_id) {
    const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id);
    enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
    if (networkMonitor.getState() === 'ONLINE') scheduleOutboxProcessing();
  }
})();
```

## Capture dual-track & LWW

- **Dual-track** : `t_sync_queue` (amont explicite) et les flags
  `is_dirty = 1` (aval, détection passive) doivent rester cohérents — ne
  jamais faire évoluer l'un sans l'autre sur une même mutation.
- **Last-Write-Wins (LWW)** : la résolution de conflit entre deux versions
  d'une même ligne (locale vs cloud) est déterministe, basée sur
  `updated_at`. Ne jamais introduire de logique de fusion de champs qui
  contournerait cette règle simple sans une justification explicite validée
  par l'utilisateur (risque de divergence silencieuse entre postes).

## Cloisonnement site/centre

Aucune requête SQL touchant `t_cartes`, `t_import_anomalies` ou toute table
liée aux cartes ne doit pouvoir fuiter ou mélanger des données entre
différents `site_id`/`centre_id` — voir `CLAUDE.md` §3 pour la règle
complète (dérivation du rôle/site/centre via `getSecureCurrentUser()`,
jamais une re-requête directe sur `t_users`).

## Invariabilité des schémas & migrations

Il est **strictement interdit** de modifier, supprimer ou altérer des
colonnes/tables SQLite ou Supabase existantes sans une analyse de migration
rétrocompatible validée par l'utilisateur. Pour Supabase spécifiquement,
`supabase_schema.sql` n'est qu'une référence documentaire — la modifier ne
suffit pas, la migration doit être réellement appliquée sur la base de
production (SQL Editor Supabase ou un dossier `supabase/migrations`
versionné), ce qui reste une action à valider explicitement.

## Règle "STOP & WARN" spécifique

Si une modification demande de toucher à une requête SQL partagée
(`*.queries.ts`), à la logique du moteur de synchro (`SyncEngine`,
`Outbox`), au schéma ou aux déclencheurs : ne rien modifier d'abord,
avertir l'utilisateur du fichier concerné et du composant impacté, et
consigner l'alerte dans le rapport final plutôt que d'attendre une réponse
en cours d'exécution (cf. `CLAUDE.md` §4).
