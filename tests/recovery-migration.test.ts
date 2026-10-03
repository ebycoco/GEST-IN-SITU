import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import log from 'electron-log';

/**
 * Recovery des migrations — chemin d'échec, snapshot logique cohérent, restauration contrôlée,
 * validation post-migration, dérive FTS5 réparée par reconstruction contrôlée, historique V66→V71.
 *
 * Bases jetables uniquement (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-recovery-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpRoot, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const LEGACY_TRIGGERS = `
  DROP TRIGGER IF EXISTS trg_cartes_ad;
  DROP TRIGGER IF EXISTS trg_cartes_au;
  DROP TRIGGER IF EXISTS trg_anomalies_ad;
  DROP TRIGGER IF EXISTS trg_anomalies_au;
  CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
    DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
  END;
  CREATE TRIGGER trg_cartes_au AFTER UPDATE OF noms, prenoms, num_secu, contact, lieu_de_naissance, rangement ON t_cartes BEGIN
    DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
    INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
    VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
  END;
  CREATE TRIGGER trg_anomalies_ad AFTER DELETE ON t_import_anomalies BEGIN
    DELETE FROM t_anomalies_fts WHERE rowid = old.id;
  END;
  CREATE TRIGGER trg_anomalies_au AFTER UPDATE ON t_import_anomalies BEGIN
    DELETE FROM t_anomalies_fts WHERE rowid = old.id;
    INSERT INTO t_anomalies_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
    VALUES (new.id, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
  END;
`;

const SITE_ID = 930;
/** Nom de t_cartes après le renommage d'injection du scénario B (V71 ne trouve plus t_cartes). */
const HORS_SERVICE = 't_cartes_hors_service';

/** Répertoire de scénario isolé ; retourne le chemin de la base (data/gest_in_situ.db). */
function scenarioDb(name: string): string {
  const dir = path.join(tmpRoot, name, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'gest_in_situ.db');
}

/** Mêmes pragmas que connection.ts (sans eux, chaque migration fait un fsync complet). */
function openLikeApp(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

const opened: Database.Database[] = [];
const track = (db: Database.Database) => { opened.push(db); return db; };

function seed(db: Database.Database, n: number): void {
  db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_REC', 'SITE_REC', 1, 'site-rec')`).run(SITE_ID);
  const ins = db.prepare(`INSERT INTO t_cartes (site_id, noms, prenoms, rangement, sync_id) VALUES (?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (let i = 0; i < n; i++) ins.run(SITE_ID, `NOM${i % 40}`, `PRENOM${i % 60}`, `AAA-${i % 25}`, `sync-rec-${Math.random()}`);
  })();
}

/** Base V70 avec dérive FTS5 : triggers legacy puis mises à jour → index strict malformé. */
function makeDriftedV70(name: string, n: number): Database.Database {
  const db = track(openLikeApp(scenarioDb(name)));
  schema.runMigrations(db);
  seed(db, n);
  db.exec(LEGACY_TRIGGERS);
  db.prepare(`UPDATE t_cartes SET rangement = 'ZZZ-1' WHERE id_carte <= 120`).run();
  db.pragma('user_version = 70');
  return db;
}

/** Base vivante en état RECOVERY_REQUIRED simulé (fichier présent + marqueur). */
function makeLiveInRecovery(name: string, n: number): string {
  const dbPath = scenarioDb(name);
  const live = track(openLikeApp(dbPath));
  schema.runMigrations(live);
  seed(live, n);
  live.close();
  recovery.writeRecoveryMarker({
    dbPath, fromVersion: 70, targetVersion: 71, reason: 'scénario de test',
    snapshotPath: null, createdAt: new Date().toISOString(),
  });
  return dbPath;
}

const countTable = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const countCartes = (db: Database.Database) => countTable(db, 't_cartes');
const userVersion = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;
const triggerSql = (db: Database.Database, name: string) =>
  (db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).get(name) as { sql: string } | undefined)?.sql ?? null;
const match = (db: Database.Database, q: string) =>
  (db.prepare('SELECT COUNT(*) AS c FROM t_cartes_fts WHERE t_cartes_fts MATCH ?').get(q) as { c: number }).c;

let schema: typeof import('../src/main/database/schema');
let recovery: typeof import('../src/main/database/recovery');
let fts: typeof import('../src/main/database/fts-maintenance');

describe('Recovery des migrations', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    schema = await import('../src/main/database/schema');
    recovery = await import('../src/main/database/recovery');
    fts = await import('../src/main/database/fts-maintenance');
  });

  beforeEach(() => {
    infoSpy?.mockRestore();
    infoSpy = vi.spyOn(log, 'info');
  });

  afterAll(() => {
    infoSpy?.mockRestore();
    for (const db of opened) { try { if (db.open) db.close(); } catch { /* déjà fermée */ } }
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const loggedMessages = () => infoSpy.mock.calls.map(c => String(c[0]));

  // ── Chemin normal et échec de migration ──────────────────────────────────────

  it('A — V70 → V71 normal : triggers canoniques, validation réussie, données conservées', () => {
    const db = track(openLikeApp(scenarioDb('A')));
    schema.runMigrations(db);
    seed(db, 300);
    db.exec(LEGACY_TRIGGERS);
    db.pragma('user_version = 70');
    const avant = countCartes(db);

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(71);
    expect(triggerSql(db, 'trg_cartes_ad')).toMatch(/VALUES\s*\(\s*'delete'/i);
    expect(triggerSql(db, 'trg_anomalies_au')).toMatch(/VALUES\s*\(\s*'delete'/i);
    expect(countCartes(db)).toBe(avant);
    expect(loggedMessages().some(m => m.includes('Running migration v71'))).toBe(true);
    expect(recovery.validateDatabase(db, 71).ok).toBe(true);
  });

  it('B — échec volontaire de V71 : rollback, snapshot cohérent, RECOVERY_REQUIRED', () => {
    const dbPath = scenarioDb('B');
    const db = track(openLikeApp(dbPath));
    schema.runMigrations(db);
    seed(db, 120);
    // Échec contrôlé : triggers legacy posés, puis t_cartes renommée. V71 exécute d'abord
    // DROP TRIGGER (dans sa transaction), puis CREATE TRIGGER ... ON t_cartes, qui échoue.
    db.exec(LEGACY_TRIGGERS);
    db.exec(`ALTER TABLE t_cartes RENAME TO ${HORS_SERVICE};`);
    db.pragma('user_version = 70');
    const avant = countTable(db, HORS_SERVICE);

    let caught: any = null;
    try { schema.runMigrations(db); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(recovery.RecoveryRequiredError);
    expect(caught.code).toBe('RECOVERY_REQUIRED');
    expect(caught.info.reason).toMatch(/no such table/);
    // Rollback : user_version inchangé ; le DROP déjà exécuté par V71 est annulé
    expect(userVersion(db)).toBe(70);
    expect(triggerSql(db, 'trg_cartes_ad')).toMatch(/DELETE FROM t_cartes_fts/i);
    expect(triggerSql(db, 'trg_anomalies_ad')).toMatch(/DELETE FROM t_anomalies_fts/i);
    // Marqueur et snapshot cohérent
    expect(fs.existsSync(recovery.recoveryMarkerPath(dbPath))).toBe(true);
    const snapshotPath: string = caught.info.snapshotPath;
    expect(snapshotPath).toBeTruthy();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = track(new Database(snapshotPath, { readonly: true }));
    expect(snap.pragma('user_version', { simple: true })).toBe(70);
    expect(countTable(snap, HORS_SERVICE)).toBe(avant);
  });

  it('C — redémarrage après échec : RECOVERY_REQUIRED, jamais V1 → V71 ni nouvelle installation', () => {
    const db = track(openLikeApp(scenarioDb('B'))); // état laissé par le scénario B
    const avant = countTable(db, HORS_SERVICE);
    infoSpy.mockClear();

    let caught: any = null;
    try { schema.runMigrations(db); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(recovery.RecoveryRequiredError);
    expect(userVersion(db)).toBe(70);
    expect(countTable(db, HORS_SERVICE)).toBe(avant);
    const msgs = loggedMessages();
    expect(msgs.some(m => m.includes('New database installation'))).toBe(false);
    expect(msgs.some(m => m.includes('Running migration v'))).toBe(false);
  });

  it('C bis — V0 moderne (tables présentes, user_version 0) : RECOVERY_REQUIRED, aucune migration, aucune écriture', () => {
    const db = track(openLikeApp(scenarioDb('C2')));
    schema.runMigrations(db);
    seed(db, 40);
    db.pragma('user_version = 0');
    infoSpy.mockClear();

    let caught: any = null;
    try { schema.runMigrations(db); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(recovery.RecoveryRequiredError);
    expect(caught.info.reason).toMatch(/version indéterminée/);
    const msgs = loggedMessages();
    expect(msgs.some(m => m.includes('New database installation'))).toBe(false);
    expect(msgs.some(m => m.includes('Running migration v'))).toBe(false);
    expect(userVersion(db)).toBe(0);
    expect(countCartes(db)).toBe(40);
    expect(fs.existsSync(caught.info.snapshotPath)).toBe(true);
  });

  it('D — historique V66 → V71 : V67, V68, V69, V70, V71 exécutées, aucun passage par V1', () => {
    const db = track(openLikeApp(scenarioDb('D')));
    schema.runMigrations(db);
    seed(db, 60);
    // État V66 : colonnes ajoutées par V67..V70 retirées, triggers legacy, user_version 66.
    db.exec(`
      ALTER TABLE t_cartes DROP COLUMN doublon_declare_par;
      ALTER TABLE t_cartes DROP COLUMN doublon_declare_le;
      ALTER TABLE t_cartes DROP COLUMN doublon_motif;
      ALTER TABLE t_cartes DROP COLUMN statut_avant_doublon;
      ALTER TABLE t_cartes DROP COLUMN doublon_annule_par;
      ALTER TABLE t_cartes DROP COLUMN doublon_annule_le;
      ALTER TABLE t_cartes DROP COLUMN doublon_motif_annulation;
      ALTER TABLE t_cartes DROP COLUMN apurement_correction_par;
      ALTER TABLE t_cartes DROP COLUMN apurement_correction_le;
      ALTER TABLE t_cartes DROP COLUMN apurement_correction_motif;
      ALTER TABLE t_cartes DROP COLUMN apurement_annulation_par;
      ALTER TABLE t_cartes DROP COLUMN apurement_annulation_le;
      ALTER TABLE t_cartes DROP COLUMN apurement_annulation_motif;
      ALTER TABLE t_cartes DROP COLUMN action_at;
      ALTER TABLE t_outbox DROP COLUMN last_attempt_at;
    `);
    db.exec(LEGACY_TRIGGERS);
    db.pragma('user_version = 66');
    infoSpy.mockClear();

    expect(() => schema.runMigrations(db)).not.toThrow();

    const msgs = loggedMessages();
    for (const v of [67, 68, 69, 70, 71]) {
      expect(msgs.some(m => m.includes(`Running migration v${v}:`)), `V${v} exécutée`).toBe(true);
    }
    expect(msgs.some(m => m.includes('New database installation'))).toBe(false);
    expect(msgs.some(m => m.includes('Running migration v1:'))).toBe(false);
    const cols = (db.pragma('table_info(t_cartes)') as { name: string }[]).map(c => c.name);
    expect(cols).toContain('doublon_declare_par');
    expect(cols).toContain('action_at');
    expect((db.pragma('table_info(t_outbox)') as { name: string }[]).map(c => c.name)).toContain('last_attempt_at');
    expect(userVersion(db)).toBe(71);
    expect(triggerSql(db, 'trg_cartes_ad')).toMatch(/VALUES\s*\(\s*'delete'/i);
    expect(countCartes(db)).toBe(60);
  });

  // ── Dérive FTS5 : reconstruction contrôlée ───────────────────────────────────

  it('G ter — V70 + FTS5 dérivé → V71 → reconstruction contrôlée → strict OK → migration réussie, t_cartes inchangées', () => {
    const db = makeDriftedV70('G3', 200);
    const nbCartes = countCartes(db);
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts', true).ok).toBe(false);
    const warnSpy = vi.spyOn(log, 'warn');

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(userVersion(db)).toBe(71);
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('Dérive FTS5 existante'))).toBe(true);
    warnSpy.mockRestore();
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts', true).ok).toBe(true);
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts', false).ok).toBe(true);
    expect(fts.checkFtsIntegrity(db, 't_anomalies_fts', true).ok).toBe(true);
    expect(countCartes(db)).toBe(nbCartes);
    expect(match(db, 'rangement:ZZZ')).toBe(120);
  });

  it('H — V70 + FTS5 dérivé + anomalie structurelle (t_logs absente) → STOP : RECOVERY_REQUIRED, aucune reconstruction', () => {
    const db = makeDriftedV70('H', 200);
    db.exec('DROP TABLE t_logs;');

    let caught: any = null;
    try { schema.runMigrations(db); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(recovery.RecoveryRequiredError);
    expect(caught.info.reason).toMatch(/table manquante : t_logs/);
    expect(userVersion(db)).toBe(70);
    // Aucune reconstruction : la dérive FTS5 est toujours présente
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts', true).ok).toBe(false);
  });

  it('I — décision du planificateur de réparation FTS5', () => {
    const base = { ok: true, failures: [], structural: [], ftsSimpleFailed: [], ftsDrift: [] } as any;
    expect(recovery.planFtsRepair(base)).toBe('none');
    expect(recovery.planFtsRepair({ ...base, ok: false, failures: ['FTS5 strict : t_cartes_fts : x'], ftsDrift: ['t_cartes_fts'] })).toBe('rebuild');
    expect(recovery.planFtsRepair({ ...base, ok: false, failures: ['table manquante : t_logs', 'FTS5 strict : t_cartes_fts : x'], structural: ['table manquante : t_logs'], ftsDrift: ['t_cartes_fts'] })).toBe('stop');
    expect(recovery.planFtsRepair({ ...base, ok: false, failures: ['FTS5 simple : t_cartes_fts : x'], ftsSimpleFailed: ['t_cartes_fts'] })).toBe('stop');
  });

  // ── Validation et backup ─────────────────────────────────────────────────────

  it('validation FTS5 : simple et strict OK sur base saine ; dérive détectée par le strict seul', () => {
    const db = track(openLikeApp(scenarioDb('G')));
    schema.runMigrations(db);
    seed(db, 200);
    const ok = recovery.validateDatabase(db, 71);
    expect(ok.failures).toEqual([]);
    expect(ok.ok).toBe(true);

    db.exec(LEGACY_TRIGGERS);
    db.prepare(`UPDATE t_cartes SET rangement = 'ZZZ-1' WHERE id_carte <= 120`).run();
    const derive = recovery.validateDatabase(db, 71);
    expect(derive.ok).toBe(false);
    expect(derive.ftsDrift).toEqual(['t_cartes_fts']);
    expect(derive.ftsSimpleFailed).toEqual([]);
    // Les triggers legacy sont classés structurels : la pipeline les réinstalle avant validation.
    expect(derive.structural.length).toBeGreaterThan(0);
    expect(derive.structural.every(f => f.startsWith('trigger FTS5'))).toBe(true);
  });

  it('validation : trigger critique manquant détecté', () => {
    const db = track(openLikeApp(scenarioDb('G2')));
    schema.runMigrations(db);
    db.exec('DROP TRIGGER trg_cartes_au;');
    const report = recovery.validateDatabase(db, 71);
    expect(report.ok).toBe(false);
    expect(report.failures).toContain('trigger manquant : trg_cartes_au');
  });

  it('E — backup avec WAL : le snapshot inclut les écritures non checkpointées, la copie brute non', () => {
    const dbPath = scenarioDb('E');
    const db = track(openLikeApp(dbPath));
    schema.runMigrations(db);
    seed(db, 400);
    expect(fs.statSync(dbPath + '-wal').size).toBeGreaterThan(0);

    const rawCopy = path.join(tmpRoot, 'E', 'raw-copy.db');
    fs.copyFileSync(dbPath, rawCopy);
    let rawCount = -1;
    const raw = track(new Database(rawCopy, { readonly: true }));
    try { rawCount = countCartes(raw); } catch { rawCount = -1; }
    expect(rawCount).not.toBe(400); // la copie brute perd les pages du WAL

    const snapPath = path.join(tmpRoot, 'E', 'snapshot.db');
    recovery.snapshotDatabase(db, snapPath);
    const snap = track(new Database(snapPath, { readonly: true }));
    expect(countCartes(snap)).toBe(400);
    expect(snap.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(fs.existsSync(snapPath + '-wal')).toBe(false);
  });

  // ── Restauration (sortie de RECOVERY_REQUIRED) ───────────────────────────────

  it('F — remplacement isolé : aucun -wal/-shm orphelin rejoué, marqueur effacé après remplacement', () => {
    const srcPath = scenarioDb('F-src');
    const src = track(openLikeApp(srcPath));
    schema.runMigrations(src);
    seed(src, 500);
    const snapPath = path.join(tmpRoot, 'F-src', 'snapshot.db');
    recovery.snapshotDatabase(src, snapPath);
    src.close();

    const isolated = path.join(tmpRoot, 'F-isolated');
    const restored = recovery.restoreSnapshotToIsolatedDir(snapPath, isolated);
    expect(restored.validation.ok).toBe(true);
    expect(fs.readdirSync(isolated).sort()).toEqual(['gest_in_situ.db']);

    const livePath = makeLiveInRecovery('F-live', 10);
    fs.writeFileSync(livePath + '-wal', Buffer.from('journal orphelin non valide'));
    fs.writeFileSync(livePath + '-shm', Buffer.from('shm orphelin'));

    recovery.replaceLiveDatabase(restored.dbPath, livePath);

    expect(fs.existsSync(livePath + '-wal')).toBe(false);
    expect(fs.existsSync(livePath + '-shm')).toBe(false);
    expect(fs.existsSync(recovery.recoveryMarkerPath(livePath))).toBe(false);
    const after = track(new Database(livePath));
    expect(countCartes(after)).toBe(500);
    expect(after.pragma('quick_check', { simple: true })).toBe('ok');
  });

  it('F bis — restauration refusée dans un répertoire non vide', () => {
    const isolated = path.join(tmpRoot, 'F-nonvide');
    fs.mkdirSync(isolated, { recursive: true });
    fs.writeFileSync(path.join(isolated, 'existant.txt'), 'x');
    expect(() => recovery.restoreSnapshotToIsolatedDir(path.join(tmpRoot, 'F-src', 'snapshot.db'), isolated)).toThrow(/non vide/);
  });

  it('J — sortie de recovery : snapshot V70 dérivé restauré → reconstruction dans la copie → strict OK → marqueur effacé', () => {
    const src = makeDriftedV70('J-src', 200);
    const snapPath = path.join(tmpRoot, 'J', 'snapshot-v70.db');
    recovery.snapshotDatabase(src, snapPath);
    src.close();

    const livePath = makeLiveInRecovery('J-live', 10);
    const backupDir = path.join(tmpRoot, 'J', 'backups');
    const outcome = recovery.performRestore({
      sourcePath: snapPath, dbPath: livePath, backupDir, liveDb: null, targetVersion: 71,
    });

    expect(outcome.ftsRepaired).toEqual(['t_cartes_fts']);
    expect(outcome.counts.t_cartes).toBe(200);
    expect(outcome.safetyPath).toBeTruthy();
    expect(fs.existsSync(outcome.safetyPath!)).toBe(true);
    expect(recovery.readRecoveryMarker(livePath)).toBeNull();
    expect(fs.readdirSync(backupDir).filter(f => f.startsWith('restore_'))).toEqual([]);
    const restored = track(new Database(livePath));
    expect(userVersion(restored)).toBe(70);
    expect(countCartes(restored)).toBe(200);
    expect(fts.checkFtsIntegrity(restored, 't_cartes_fts', true).ok).toBe(true);
    // L'état vivant en recovery (10 cartes) est conservé dans le snapshot de sécurité
    const safety = track(new Database(outcome.safetyPath!, { readonly: true }));
    expect(countCartes(safety)).toBe(10);
  });

  it('J bis — restauration refusée (fichier non SQLite) : base vivante et marqueur intacts', () => {
    const garbage = path.join(tmpRoot, 'J2', 'garbage.db');
    fs.mkdirSync(path.dirname(garbage), { recursive: true });
    fs.writeFileSync(garbage, 'ceci n\'est pas une base SQLite');
    const livePath = makeLiveInRecovery('J2-live', 10);
    const backupDir = path.join(tmpRoot, 'J2', 'backups');

    expect(() => recovery.performRestore({
      sourcePath: garbage, dbPath: livePath, backupDir, liveDb: null, targetVersion: 71,
    })).toThrow(recovery.RestoreRefusedError);

    expect(recovery.readRecoveryMarker(livePath)).not.toBeNull();
    const live = track(new Database(livePath));
    expect(countCartes(live)).toBe(10);
    expect(fs.readdirSync(backupDir).filter(f => f.startsWith('restore_'))).toEqual([]);
  });

  it('J ter — restauration refusée : snapshot à user_version 0', () => {
    const base = track(openLikeApp(scenarioDb('J3-base')));
    schema.runMigrations(base);
    const snapPath = path.join(tmpRoot, 'J3', 'snap-v0.db');
    recovery.snapshotDatabase(base, snapPath);
    const snap = track(new Database(snapPath));
    snap.pragma('user_version = 0');
    snap.close();
    const livePath = makeLiveInRecovery('J3-live', 10);

    expect(() => recovery.performRestore({
      sourcePath: snapPath, dbPath: livePath, backupDir: path.join(tmpRoot, 'J3', 'backups'), liveDb: null, targetVersion: 71,
    })).toThrow(/user_version 0 hors de la plage/);
    expect(recovery.readRecoveryMarker(livePath)).not.toBeNull();
  });

  it('J quinquies — restauration refusée : snapshot de recovery d\'un échec de migration', () => {
    const base = track(openLikeApp(scenarioDb('J5-base')));
    schema.runMigrations(base);
    const snapPath = path.join(tmpRoot, 'J5', 'recovery_v70_to_v71_2026-10-03T10-00-00-000Z.db');
    recovery.snapshotDatabase(base, snapPath);
    const livePath = makeLiveInRecovery('J5-live', 10);
    const backupDir = path.join(tmpRoot, 'J5', 'backups');

    expect(() => recovery.performRestore({
      sourcePath: snapPath, dbPath: livePath, backupDir, liveDb: null, targetVersion: 71,
    })).toThrow(/snapshot d'un échec de migration/);
    expect(recovery.readRecoveryMarker(livePath)).not.toBeNull();
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it('J quater — restauration refusée : snapshot sans table critique (anomalie hors FTS5)', () => {
    const base = track(openLikeApp(scenarioDb('J4-base')));
    schema.runMigrations(base);
    base.exec('DROP TABLE t_logs;');
    const snapPath = path.join(tmpRoot, 'J4', 'snap-sans-logs.db');
    recovery.snapshotDatabase(base, snapPath);
    const livePath = makeLiveInRecovery('J4-live', 10);

    expect(() => recovery.performRestore({
      sourcePath: snapPath, dbPath: livePath, backupDir: path.join(tmpRoot, 'J4', 'backups'), liveDb: null, targetVersion: 71,
    })).toThrow(/anomalie non réparable automatiquement/);
    expect(recovery.readRecoveryMarker(livePath)).not.toBeNull();
  });
});
