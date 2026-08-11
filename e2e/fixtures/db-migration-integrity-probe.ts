/**
 * e2e/fixtures/db-migration-integrity-probe.ts
 *
 * Sonde QA terrain (agent-13) dédiée à la validation du correctif de
 * fiabilité de migration (migrateV64 auto-réparatrice, runMigrationSequence
 * partagée, migrateV66_structuralIntegrityNet). Suit le même contournement
 * ABI que `db-migration-probe.ts` : importe `better-sqlite3` (natif), donc
 * ne doit JAMAIS être importé directement par un fichier de spec Playwright
 * (Node système) — uniquement via `db-migration-integrity-probe-runner.ts`.
 *
 * Trois modes, sélectionnés par argv[3] :
 *   - "corrupt_v66_gaps" : mute une base DÉJÀ seedée (schéma réel v66) pour
 *     reproduire EXACTEMENT les trois manques structurels constatés en
 *     production sur le poste affecté (avec `PRAGMA user_version` resté
 *     mensongèrement à 65) :
 *       1. CHECK(role) de t_users/t_user_roles reconstruit SANS
 *          'OPERATEUR_APUREMENT' (retour à l'état pré-V64).
 *       2. CHECK(statut) de t_cartes reconstruit SANS 'DOUBLON' (retour à
 *          l'état pré-V60).
 *       3. DROP des deux index de performance V61/V62.
 *     Aucune ligne n'est rendue orpheline par ce mode : seules les
 *     contraintes/index sont régressés, jamais les données. Force ensuite
 *     `user_version = 65`.
 *   - "inject_orphans" : insère une ligne t_users de test (préfixe ZZTEST_)
 *     avec site_id/centre_id/poste_id pointant vers des id inexistants dans
 *     t_sites/t_centres/t_postes, puis force `user_version` à la valeur
 *     fournie (< 64, pour forcer le rejeu normal de migrateV64 au prochain
 *     démarrage).
 *   - "inspect" : lit l'état courant sans rien modifier (user_version, SQL
 *     des CHECK, présence des index, comptage des lignes t_users orphelines
 *     ZZTEST_ restantes).
 */
import Database from 'better-sqlite3';
import { join } from 'path';

const PROBE_RESULT_MARKER = '__E2E_INTEGRITY_PROBE_RESULT__:';
const TARGET_INDEXES = ['idx_cartes_created_by_created_at', 'idx_cartes_site_centre_statut'];
const ORPHAN_PREFIX = 'ZZTEST_ORPHAN_';

function resolveDbPath(userDataDir: string): string {
  return join(userDataDir, 'data', 'gest_in_situ.db');
}

function rebuildTableWithCheckRemoval(
  db: Database.Database,
  tableName: string,
  backupSuffix: string,
  removeCheckValues: string[],
  originalSqlOverride?: string
): void {
  const columnsRaw = db.pragma(`table_info(${tableName})`) as { name: string }[];
  const colsToCopy = columnsRaw.map((c) => c.name).join(', ');

  const oldIndexes = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`)
    .all(tableName) as { name: string; sql: string }[];
  const oldTriggers = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND sql IS NOT NULL`)
    .all(tableName) as { name: string; sql: string }[];

  const backupName = `${tableName}_${backupSuffix}`;
  db.exec(`ALTER TABLE ${tableName} RENAME TO ${backupName}`);

  // ── Piège SQLite (documenté dans migrateV64/schema.ts) ──────────────────
  // Un `ALTER TABLE ... RENAME TO` réécrit SILENCIEUSEMENT la clause FOREIGN
  // KEY de toute AUTRE table qui référence celle qu'on vient de renommer (ex :
  // t_user_roles → t_users). Si `originalSqlOverride` est fourni (capturé
  // AVANT ce rename), on l'utilise directement au lieu de relire
  // `sqlite_master` — qui contiendrait alors cette référence corrompue vers
  // `backupName` plutôt que vers le vrai nom de table.
  let sourceSql: string;
  if (originalSqlOverride) {
    sourceSql = originalSqlOverride;
  } else {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
      .get(backupName) as { sql: string } | undefined;
    if (!row || !row.sql) {
      throw new Error(`[PROBE] Impossible de lire la définition de ${backupName}`);
    }
    sourceSql = row.sql;
  }

  let newSql = sourceSql.replace(new RegExp(`"?${backupName}"?`, 'g'), tableName);

  for (const val of removeCheckValues) {
    // Retire la valeur (avec sa virgule précédente si présente) de n'importe
    // quelle clause CHECK(... IN (...)) — ciblé, pas de dépendance au nom de
    // colonne pour rester générique entre t_users.role et t_cartes.statut.
    newSql = newSql.replace(new RegExp(`,\\s*'${val}'`, 'g'), '');
    newSql = newSql.replace(new RegExp(`'${val}'\\s*,\\s*`, 'g'), '');
  }

  db.exec(newSql);
  db.exec(`INSERT INTO ${tableName} (${colsToCopy}) SELECT ${colsToCopy} FROM ${backupName}`);
  db.exec(`DROP TABLE ${backupName}`);

  for (const idx of oldIndexes) db.exec(idx.sql);
  for (const trg of oldTriggers) db.exec(trg.sql);
}

interface CorruptV66Result {
  mode: 'corrupt_v66_gaps';
  dbPath: string;
  userVersionBefore: number;
  userVersionForced: number;
  usersCheckHadApurementBefore: boolean;
  cartesCheckHadDoublonBefore: boolean;
  indexesDropped: string[];
}

function runCorruptV66Gaps(userDataDir: string): CorruptV66Result {
  const dbPath = resolveDbPath(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // reconstruction de tables, réactivé en fin de script réel au prochain démarrage app

  const userVersionBefore = db.pragma('user_version', { simple: true }) as number;

  const usersRowBefore = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_users'").get() as { sql: string };
  const usersCheckHadApurementBefore = usersRowBefore.sql.includes("'OPERATEUR_APUREMENT'");

  const cartesRowBefore = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_cartes'").get() as { sql: string };
  const cartesCheckHadDoublonBefore = cartesRowBefore.sql.includes("'DOUBLON'");

  db.exec('BEGIN EXCLUSIVE TRANSACTION');
  try {
    // Réalisme : sur le poste de production réellement affecté, le CHECK(role)
    // n'a JAMAIS autorisé 'OPERATEUR_APUREMENT' avant V64 — aucun compte avec ce
    // rôle n'a donc jamais pu exister avant la reconstruction du schéma. La
    // fixture de seed (test-users.ts) insère elle un compte 'operateurApurement'
    // dès l'installation (schéma déjà réel v66) : pour rester fidèle à l'état
    // réel simulé, on retire ces comptes avant de restreindre le CHECK — sans
    // quoi la copie échouerait sur une contrainte que la production n'a, en
    // pratique, jamais pu violer.
    db.exec("DELETE FROM t_user_roles WHERE role = 'OPERATEUR_APUREMENT'");
    db.exec("DELETE FROM t_users WHERE role = 'OPERATEUR_APUREMENT'");

    // Capture du SQL ORIGINAL de t_user_roles AVANT de renommer t_users (voir
    // commentaire dans rebuildTableWithCheckRemoval) : t_user_roles référence
    // t_users par FOREIGN KEY, et ce rename réécrirait silencieusement cette
    // référence si on la relisait après coup.
    const userRolesOriginalSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_user_roles'").get() as { sql: string }
    ).sql;

    rebuildTableWithCheckRemoval(db, 't_users', 'probe_backup', ['OPERATEUR_APUREMENT']);
    rebuildTableWithCheckRemoval(db, 't_user_roles', 'probe_backup', ['OPERATEUR_APUREMENT'], userRolesOriginalSql);
    rebuildTableWithCheckRemoval(db, 't_cartes', 'probe_backup', ['DOUBLON']);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const indexesDropped: string[] = [];
  for (const idx of TARGET_INDEXES) {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`).get(idx);
    if (exists) {
      db.exec(`DROP INDEX IF EXISTS ${idx}`);
      indexesDropped.push(idx);
    }
  }

  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check', { simple: true });
  if (typeof integrity === 'string' && integrity.toLowerCase() !== 'ok') {
    throw new Error(`[PROBE] integrity_check post-corruption a échoué : ${integrity}`);
  }

  db.pragma('user_version = 65');
  const userVersionForced = db.pragma('user_version', { simple: true }) as number;

  db.close();

  return {
    mode: 'corrupt_v66_gaps',
    dbPath,
    userVersionBefore,
    userVersionForced,
    usersCheckHadApurementBefore,
    cartesCheckHadDoublonBefore,
    indexesDropped
  };
}

interface InjectOrphansResult {
  mode: 'inject_orphans';
  dbPath: string;
  userVersionBefore: number;
  userVersionForced: number;
  orphanLogin: string;
  orphanSiteId: number;
  orphanCentreId: number;
  orphanPosteId: number;
}

function runInjectOrphans(userDataDir: string, targetVersion: number): InjectOrphansResult {
  const dbPath = resolveDbPath(userDataDir);
  const db = new Database(dbPath, { timeout: 30000 });
  db.pragma('journal_mode = WAL');
  // FK doit rester désactivée le temps de l'insertion volontairement invalide
  // (sinon SQLite refuserait l'INSERT lui-même) — cohérent avec l'état réel
  // constaté en prod, où l'orphelinage est apparu progressivement (site/centre
  // supprimé APRÈS la création du compte, jamais via un INSERT direct FK-off).
  db.pragma('foreign_keys = OFF');

  const userVersionBefore = db.pragma('user_version', { simple: true }) as number;

  // ── Précondition réaliste pour que migrateV64 exécute réellement son corps
  // (rebuild + neutralisation Volet 1) au lieu de sortir immédiatement via sa
  // garde d'idempotence ────────────────────────────────────────────────────
  // migrateV64() retourne AVANT toute chose (y compris la neutralisation des
  // orphelins) si le CHECK(role) contient déjà 'OPERATEUR_APUREMENT' (voir
  // schema.ts, "reconstruction inutile, sortie anticipée"). Un vrai poste
  // bloqué avant V64 n'a, par construction, jamais pu contenir ce libellé
  // (le CHECK ne l'a jamais autorisé) : on reproduit fidèlement cet état ici
  // — sans quoi cette sonde prouverait uniquement le chemin idempotent
  // (aucune neutralisation exécutée), pas le Volet 1 lui-même.
  db.exec("DELETE FROM t_user_roles WHERE role = 'OPERATEUR_APUREMENT'");
  db.exec("DELETE FROM t_users WHERE role = 'OPERATEUR_APUREMENT'");

  // Capture du SQL ORIGINAL de t_user_roles AVANT de renommer t_users — voir
  // commentaire détaillé dans rebuildTableWithCheckRemoval (piège de
  // propagation SQLite du RENAME sur les clauses FOREIGN KEY des autres
  // tables).
  const userRolesOriginalSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_user_roles'").get() as { sql: string }
  ).sql;

  db.exec('BEGIN EXCLUSIVE TRANSACTION');
  try {
    rebuildTableWithCheckRemoval(db, 't_users', 'probe_backup', ['OPERATEUR_APUREMENT']);
    rebuildTableWithCheckRemoval(db, 't_user_roles', 'probe_backup', ['OPERATEUR_APUREMENT'], userRolesOriginalSql);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const now = Date.now();
  const orphanLogin = `${ORPHAN_PREFIX}${now}`;
  const orphanSiteId = 999001;
  const orphanCentreId = 999002;
  const orphanPosteId = 999003;

  // Hash bcrypt fixe (jamais utilisé pour une vraie connexion — ce compte est
  // supprimé en fin de session QA) : évite de dépendre d'une importation
  // supplémentaire dans ce script bundlé isolément.
  const FIXED_TEST_HASH = '$2b$10$abcdefghijklmnopqrstuuZKz0X0X0X0X0X0X0X0X0X0X0X0X0X0e';

  db.prepare(
    `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, poste_id, sync_id, is_dirty)
     VALUES (?, ?, 'ADMIN_CENTRE', 'ZZTEST_ORPHAN', 'QA_TERRAIN', 1, ?, ?, ?, ?, 0)`
  ).run(orphanLogin, FIXED_TEST_HASH, orphanSiteId, orphanCentreId, orphanPosteId, `zztest-orphan-${now}`);

  db.pragma(`user_version = ${targetVersion}`);
  const userVersionForced = db.pragma('user_version', { simple: true }) as number;

  db.close();

  return {
    mode: 'inject_orphans',
    dbPath,
    userVersionBefore,
    userVersionForced,
    orphanLogin,
    orphanSiteId,
    orphanCentreId,
    orphanPosteId
  };
}

interface InspectResult {
  mode: 'inspect';
  dbPath: string;
  userVersion: number;
  usersCheckHasApurement: boolean;
  cartesCheckHasDoublon: boolean;
  indexesPresent: Record<string, boolean>;
  orphanUsersRemaining: number;
}

function runInspect(userDataDir: string): InspectResult {
  const dbPath = resolveDbPath(userDataDir);
  const db = new Database(dbPath, { timeout: 30000, readonly: true });

  const userVersion = db.pragma('user_version', { simple: true }) as number;

  const usersRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_users'").get() as { sql: string };
  const usersCheckHasApurement = usersRow.sql.includes("'OPERATEUR_APUREMENT'");

  const cartesRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_cartes'").get() as { sql: string };
  const cartesCheckHasDoublon = cartesRow.sql.includes("'DOUBLON'");

  const indexesPresent: Record<string, boolean> = {};
  for (const idx of TARGET_INDEXES) {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`).get(idx);
    indexesPresent[idx] = !!exists;
  }

  const orphanUsersRemaining = (
    db.prepare(`SELECT COUNT(*) AS c FROM t_users WHERE login LIKE ?`).get(`${ORPHAN_PREFIX}%`) as { c: number }
  ).c;

  db.close();

  return { mode: 'inspect', dbPath, userVersion, usersCheckHasApurement, cartesCheckHasDoublon, indexesPresent, orphanUsersRemaining };
}

function isRunAsScript(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof require !== 'undefined' && require.main === module;
}

if (isRunAsScript()) {
  const [, , userDataDir, mode, arg3] = process.argv;
  if (!userDataDir || !mode) {
    console.error('[PROBE] Usage: db-migration-integrity-probe <userDataDir> <corrupt_v66_gaps|inject_orphans|inspect> [targetVersion]');
    process.exit(1);
  }
  try {
    let result: CorruptV66Result | InjectOrphansResult | InspectResult;
    if (mode === 'corrupt_v66_gaps') {
      result = runCorruptV66Gaps(userDataDir);
    } else if (mode === 'inject_orphans') {
      const targetVersion = Number(arg3);
      if (!targetVersion) {
        console.error('[PROBE] inject_orphans requires targetVersion');
        process.exit(1);
      }
      result = runInjectOrphans(userDataDir, targetVersion);
    } else if (mode === 'inspect') {
      result = runInspect(userDataDir);
    } else {
      console.error(`[PROBE] Mode inconnu : ${mode}`);
      process.exit(1);
    }
    console.log(PROBE_RESULT_MARKER + JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error('[PROBE] Échec :', err?.stack || err?.message || err);
    process.exit(1);
  }
}

export { PROBE_RESULT_MARKER };
