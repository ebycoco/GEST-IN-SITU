import Database from 'better-sqlite3';

/**
 * Maintenance des index FTS5 à contenu externe (P0-D, audit du 27/09/2026).
 *
 * Branché au démarrage uniquement dans la migration (schema.ts, runMigrations) et dans la restauration
 * (recovery.ts, performRestore), et seulement si la SEULE anomalie est une dérive FTS5 (strict KO,
 * simple OK). Aucun appel IPC. Toute autre anomalie arrête la migration en RECOVERY_REQUIRED sans
 * reconstruction. Mécanisme testé sur bases jetables (tests/p0d-fts5-triggers.test.ts).
 *
 * Contrôle simple vs strict : `integrity-check` sans argument (celui de connection.ts au
 * démarrage) ne compare PAS le contenu de l'index à la table de contenu externe ; seul
 * `integrity-check` avec rank=1 le fait. C'est ce contrôle strict qui échoue sur une base
 * dérivée par les anciens triggers, alors que le contrôle simple passe.
 */

export type FtsTable = 't_cartes_fts' | 't_anomalies_fts';

export interface FtsIntegrityResult {
  table: FtsTable;
  strict: boolean;
  ok: boolean;
  error?: string;
}

export function checkFtsIntegrity(db: Database.Database, table: FtsTable, strict = true): FtsIntegrityResult {
  try {
    if (strict) {
      db.prepare(`INSERT INTO ${table}(${table}, rank) VALUES('integrity-check', 1)`).run();
    } else {
      db.prepare(`INSERT INTO ${table}(${table}) VALUES('integrity-check')`).run();
    }
    return { table, strict, ok: true };
  } catch (e: any) {
    return { table, strict, ok: false, error: e?.message || String(e) };
  }
}

export interface FtsRebuildResult {
  table: FtsTable;
  durationMs: number;
  integrityAfter: FtsIntegrityResult;
}

/**
 * Reconstruit un index FTS5 à contenu externe depuis sa table de contenu.
 *
 * Choix délibéré d'UNE transaction atomique plutôt que d'un découpage en lots :
 * - un rebuild partiel entrelacé avec les triggers (écritures métier pendant la reconstruction)
 *   laisserait l'index dans un état mixte, précisément le type d'incohérence corrigé ici ;
 * - en cas d'interruption (arrêt, crash), SQLite annule tout : l'index reste dans son état
 *   antérieur et l'opération est simplement relancée (idempotente) ;
 * - la mémoire JS n'est pas sollicitée (aucune ligne ne transite par le process Node), seule
 *   la page cache SQLite travaille. Mesure sur une copie de la base dev (220 693 cartes) :
 *   rebuild ≈ 12,4 s, contrôle strict ensuite ≈ 4,2 s, OK.
 * Conséquence : l'appelant doit l'exécuter hors des heures d'activité ou depuis un worker
 * disposant de sa propre connexion (le verrou d'écriture est tenu pendant toute la durée).
 * Les triggers doivent être canoniques (migration V71) AVANT l'appel, sinon la dérive reprend.
 */
export function rebuildFtsIndex(db: Database.Database, table: FtsTable): FtsRebuildResult {
  const start = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO ${table}(${table}) VALUES('rebuild')`).run();
  })();
  const durationMs = Date.now() - start;
  return { table, durationMs, integrityAfter: checkFtsIntegrity(db, table, true) };
}
