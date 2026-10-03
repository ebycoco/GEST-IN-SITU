import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import log from 'electron-log';

/**
 * Migration V72 — réparation de la clé étrangère de t_logs pointant vers une table absente.
 *
 * Panne terrain (diagnostic/*.log) : `SqliteError: no such table: main.t_users_backup_v63` à chaque
 * écriture dans t_logs. Cause : migrateV64 renomme t_users en t_users_backup_v63 ; SQLite ≥ 3.26
 * réécrit alors la clause REFERENCES de t_logs, qui reste pointée sur la table renommée puis supprimée.
 *
 * La panne est reproduite ici en exécutant la vraie migrateV64 (pas une FK forgée à la main).
 * Bases jetables uniquement (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-v72-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpRoot, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE_ID = 972;
const ORPHAN_USER_ID = 424242;

function scenarioDb(name: string): string {
  const dir = path.join(tmpRoot, name, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'gest_in_situ.db');
}

/** Mêmes pragmas que connection.ts. */
function openLikeApp(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

const opened: Database.Database[] = [];
const track = (db: Database.Database) => { opened.push(db); return db; };

const userVersion = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;
const fkTargets = (db: Database.Database, table: string) =>
  (db.pragma(`foreign_key_list(${table})`) as { table: string; from: string; to: string | null }[]);
const tLogsSchema = (db: Database.Database) =>
  db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 't_logs' ORDER BY type, name").all();
const allLogs = (db: Database.Database) => db.prepare('SELECT * FROM t_logs ORDER BY id_log').all();
const logsSeq = (db: Database.Database) =>
  (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 't_logs'").get() as { seq: number } | undefined)?.seq ?? null;

/** Base saine (installation neuve) + un utilisateur, des lignes t_logs dont une orpheline. */
function makeHealthy(name: string): { db: Database.Database; userId: number } {
  const db = track(openLikeApp(scenarioDb(name)));
  schema.runMigrations(db);
  db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_V72', 'SITE_V72', 1, 'site-v72')`).run(SITE_ID);
  const userId = Number(db.prepare(
    `INSERT INTO t_users (login, password_hash, role, site_id, sync_id) VALUES ('agent_v72', 'x', 'OPERATEUR_VERIFICATION', ?, 'user-v72')`
  ).run(SITE_ID).lastInsertRowid);
  const ins = db.prepare(`INSERT INTO t_logs (id_user, login_user, action, detail, site_id, sync_id, is_dirty) VALUES (?, ?, ?, ?, ?, ?, 1)`);
  for (let i = 0; i < 25; i++) ins.run(i % 3 === 0 ? null : userId, 'agent_v72', 'CARTE_DELIVREE', `detail ${i}`, SITE_ID, `log-v72-${i}`);
  // Ligne orpheline (utilisateur supprimé, ou rapatriée du cloud avec foreign_keys OFF comme downstream.ts)
  db.pragma('foreign_keys = OFF');
  ins.run(ORPHAN_USER_ID, 'ancien_agent', 'CARTE_DELIVREE', 'orpheline', SITE_ID, 'log-v72-orphan');
  db.pragma('foreign_keys = ON');
  // Trou dans la séquence AUTOINCREMENT : la dernière ligne est supprimée, seq doit être conservé
  ins.run(userId, 'agent_v72', 'TEMP', 'supprimee', SITE_ID, 'log-v72-temp');
  db.prepare("DELETE FROM t_logs WHERE sync_id = 'log-v72-temp'").run();
  return { db, userId };
}

/**
 * Ramène t_users à un CHECK(role) sans OPERATEUR_APUREMENT (état pré-V64) SANS réécrire la FK de
 * t_logs (procédure create/copy/drop/rename : seul le nom temporaire est réécrit).
 */
function downgradeUsersToPreV64(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_users'").get() as { sql: string }).sql;
  const downgraded = usersSql
    .replace(",'OPERATEUR_APUREMENT'", '')
    .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?t_users"?/i, 'CREATE TABLE t_users_dg');
  expect(downgraded).not.toContain('OPERATEUR_APUREMENT');
  db.transaction(() => {
    db.exec(downgraded);
    db.exec('INSERT INTO t_users_dg SELECT * FROM t_users');
    db.exec('DROP TABLE t_users');
    db.exec('ALTER TABLE t_users_dg RENAME TO t_users');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_t_users_sync_id ON t_users(sync_id)');
  })();
  db.pragma('foreign_keys = ON');
  expect(fkTargets(db, 't_logs').map(f => f.table)).toEqual(['t_users']);
}

/**
 * État des postes terrain passés par l'ANCIENNE migrateV64 (avant correctif) : t_logs reconstruite
 * à l'identique, mais avec REFERENCES t_users_backup_v63 (table absente). Lignes, index et séquence
 * AUTOINCREMENT conservés.
 */
function breakLikeOldV64(db: Database.Database): void {
  const seq = logsSeq(db);
  const tableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='t_logs'").get() as { sql: string }).sql;
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='t_logs' AND sql IS NOT NULL").all() as { sql: string }[];
  const brokenSql = tableSql
    .replace(/REFERENCES\s+"?t_users"?/i, 'REFERENCES "t_users_backup_v63"')
    .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?t_logs"?/i, 'CREATE TABLE t_logs_broken');
  expect(brokenSql).toContain('t_users_backup_v63');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(brokenSql);
    db.exec('INSERT INTO t_logs_broken SELECT * FROM t_logs');
    db.exec('DROP TABLE t_logs');
    db.exec('ALTER TABLE t_logs_broken RENAME TO t_logs');
    for (const idx of indexes) db.exec(idx.sql);
    if (seq !== null) db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 't_logs'").run(seq);
  })();
  db.pragma('foreign_keys = ON');
  db.pragma('user_version = 71');
  expect(fkTargets(db, 't_logs').map(f => f.table)).toEqual(['t_users_backup_v63']);
}

let schema: typeof import('../src/main/database/schema');

describe('Migration V72 — FK de t_logs vers une table absente', () => {
  beforeAll(async () => {
    schema = await import('../src/main/database/schema');
  });

  afterAll(() => {
    for (const db of opened) { try { if (db.open) db.close(); } catch { /* déjà fermée */ } }
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('reproduction : une FK de t_logs vers t_users_backup_v63 fait échouer tout INSERT (panne terrain)', () => {
    const { db, userId } = makeHealthy('repro');
    breakLikeOldV64(db);

    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id) VALUES (?, 'agent_v72', 'TEST', 'repro-insert')`).run(userId))
      .toThrow(/no such table: main\.t_users_backup_v63/);
  });

  it('cause racine : migrateV64 (rejouée par le filet V66) ne casse plus la FK de t_logs', () => {
    const { db, userId } = makeHealthy('v64');
    downgradeUsersToPreV64(db);

    schema.migrateV64(db);

    expect(fkTargets(db, 't_logs').map(f => f.table)).toEqual(['t_users']);
    expect(fkTargets(db, 't_user_roles').map(f => f.table)).toEqual(['t_users']);
    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id) VALUES (?, 'agent_v72', 'TEST', 'v64-insert')`).run(userId))
      .not.toThrow();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('(a) base avec FK cassée → réparée vers t_users(id_user), lignes conservées à l\'identique, séquence préservée', () => {
    const { db } = makeHealthy('a');
    breakLikeOldV64(db);
    const logsAvant = allLogs(db);
    const seqAvant = logsSeq(db);
    const indexAvant = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='t_logs' AND sql IS NOT NULL ORDER BY name").all();
    const warnSpy = vi.spyOn(log, 'warn');

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(72);
    const fks = fkTargets(db, 't_logs');
    expect(fks).toHaveLength(1);
    expect(fks[0].table).toBe('t_users');
    expect(fks[0].from).toBe('id_user');
    expect(fks[0].to).toBe('id_user');
    expect(allLogs(db)).toEqual(logsAvant);
    expect(logsSeq(db)).toBe(seqAvant);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='t_logs' AND sql IS NOT NULL ORDER BY name").all()).toEqual(indexAvant);
    expect(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE 't_logs_v72%'").get()).toEqual({ c: 0 });
    // Ligne orpheline conservée et signalée, jamais supprimée
    expect(db.prepare("SELECT COUNT(*) AS c FROM t_logs WHERE id_user = ?").get(ORPHAN_USER_ID)).toEqual({ c: 1 });
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('[MIGRATION V72]') && String(c[0]).includes('orpheline'))).toBe(true);
    warnSpy.mockRestore();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('(b) base saine → t_logs strictement inchangée, passage en V72', () => {
    const { db } = makeHealthy('b');
    db.pragma('user_version = 71');
    const schemaAvant = tLogsSchema(db);
    const logsAvant = allLogs(db);
    const seqAvant = logsSeq(db);

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(72);
    expect(tLogsSchema(db)).toEqual(schemaAvant);
    expect(allLogs(db)).toEqual(logsAvant);
    expect(logsSeq(db)).toBe(seqAvant);
  });

  it('(c) idempotence : relances (V72 à jour, puis rejouée depuis V71) sans effet', () => {
    const { db } = makeHealthy('c');
    breakLikeOldV64(db);
    schema.runMigrations(db);
    const schemaApres = tLogsSchema(db);
    const logsApres = allLogs(db);

    expect(() => schema.runMigrations(db)).not.toThrow();
    expect(tLogsSchema(db)).toEqual(schemaApres);

    db.pragma('user_version = 71');
    expect(() => schema.runMigrations(db)).not.toThrow();
    expect(userVersion(db)).toBe(72);
    expect(tLogsSchema(db)).toEqual(schemaApres);
    expect(allLogs(db)).toEqual(logsApres);
  });

  it('(d) après migration : INSERT dans t_logs réussi, sémantique FK canonique, ligne orpheline modifiable', () => {
    const { db, userId } = makeHealthy('d');
    breakLikeOldV64(db);
    schema.runMigrations(db);

    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id, is_dirty) VALUES (?, 'agent_v72', 'CARTE_DELIVREE', 'd-1', 1)`).run(userId)).not.toThrow();
    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id, is_dirty) VALUES (NULL, 'SYSTEM', 'SYNC_UPDATE', 'd-2', 1)`).run()).not.toThrow();
    // Sémantique d'origine (V1) : un id_user inconnu est refusé quand foreign_keys = ON
    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id) VALUES (?, 'x', 'TEST', 'd-3')`).run(ORPHAN_USER_ID + 1))
      .toThrow(/FOREIGN KEY constraint failed/);
    // Une ligne orpheline existante reste modifiable sur ses colonnes hors FK (is_read, is_dirty...)
    expect(() => db.prepare('UPDATE t_logs SET is_read = 1, is_dirty = 0 WHERE id_user = ?').run(ORPHAN_USER_ID)).not.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS c FROM t_logs WHERE sync_id IN ('d-1', 'd-2')").get()).toEqual({ c: 2 });
  });

  it('(e) base déjà estampillée 72 avec FK t_logs cassée (V72 en échec lors d\'un rejeu V64 par V66) → réparée au démarrage suivant', () => {
    const { db, userId } = makeHealthy('e');
    breakLikeOldV64(db);
    db.pragma('user_version = 72');
    const logsAvant = allLogs(db);

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(72);
    expect(fkTargets(db, 't_logs').map(f => f.table)).toEqual(['t_users']);
    expect(allLogs(db)).toEqual(logsAvant);
    expect(() => db.prepare(`INSERT INTO t_logs (id_user, login_user, action, sync_id) VALUES (?, 'agent_v72', 'TEST', 'e-insert')`).run(userId))
      .not.toThrow();
  });

  it('(f) base saine estampillée 72 : le rappel inconditionnel de V72 n\'écrit rien', () => {
    const { db } = makeHealthy('f');
    const schemaAvant = tLogsSchema(db);
    const changesAvant = db.prepare('SELECT total_changes() AS c').get() as { c: number };

    schema.migrateV72(db);

    expect(db.prepare('SELECT total_changes() AS c').get()).toEqual(changesAvant);
    expect(tLogsSchema(db)).toEqual(schemaAvant);
  });

  it('(g) échec de V72 depuis migrateV64 : message dédié journalisé, erreur propagée', () => {
    const { db } = makeHealthy('g');
    downgradeUsersToPreV64(db);
    // Injection d'échec : FK de t_logs vers une table absente écrite entre apostrophes, que la
    // réécriture de V72 ne reconnaît pas → FK toujours cassée après reconstruction → V72 lève.
    db.pragma('foreign_keys = OFF');
    db.exec('ALTER TABLE t_logs RENAME TO t_logs_orig');
    db.exec("CREATE TABLE t_logs (id_log INTEGER PRIMARY KEY AUTOINCREMENT, id_user INTEGER, login_user TEXT, action TEXT NOT NULL, FOREIGN KEY (id_user) REFERENCES 't_table_absente'(id_user))");
    db.exec('DROP TABLE t_logs_orig');
    db.pragma('foreign_keys = ON');
    const errorSpy = vi.spyOn(log, 'error');

    expect(() => schema.migrateV64(db)).toThrow(/FK de t_logs toujours cassée/);

    expect(errorSpy.mock.calls.some(c => String(c[0]).includes('[MIGRATION V64] V64 appliquée, mais réparation t_logs (V72) en échec'))).toBe(true);
    errorSpy.mockRestore();
  });

  it('autres FK cassées : signalées uniquement, jamais réparées', () => {
    const { db } = makeHealthy('autres');
    db.exec('CREATE TABLE t_test_fk_cassee (id INTEGER PRIMARY KEY, ref_id INTEGER, FOREIGN KEY (ref_id) REFERENCES t_table_disparue(id))');
    const sqlAvant = (db.prepare("SELECT sql FROM sqlite_master WHERE name='t_test_fk_cassee'").get() as { sql: string }).sql;
    db.pragma('user_version = 71');
    const warnSpy = vi.spyOn(log, 'warn');

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(72);
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name='t_test_fk_cassee'").get() as { sql: string }).sql).toBe(sqlAvant);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('[MIGRATION V72]') && String(c[0]).includes('t_test_fk_cassee'))).toBe(true);
    warnSpy.mockRestore();
  });
});
