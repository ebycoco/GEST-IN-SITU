import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

/**
 * Migration V73 — index idx_cartes_stats_dp_centre (site_id, centre_id, noms, prenoms,
 * date_de_naissance, cle_doublon) pour stats:get filtré par centre (stats-worker.js, requêtes
 * doublons probables / stricts / dates vides / dates invalides). Index purement local.
 * Bases jetables uniquement (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-v73-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpRoot, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const INDEX = 'idx_cartes_stats_dp_centre';
const SITE = 7301;
const CENTRES = [1, 2, 3, 4, 5, 6, 7, 8];

let schema: typeof import('../src/main/database/schema');
let db: Database.Database;

const indexNames = (d: Database.Database) =>
  (d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='t_cartes'").all() as { name: string }[]).map(r => r.name);

const plan = (sql: string, params: Record<string, unknown>): string =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params) as { detail: string }[]).map(r => r.detail).join(' | ');

// Requêtes de stats-worker.js (case getStats), whereClause fabriquée comme stats.queries.ts.
const WHERE_CENTRE = 'WHERE site_id = @siteId AND centre_id = @centreId';
const WHERE_SITE = 'WHERE site_id = @siteId';
const doublonsProbables = (w: string) => `
  SELECT SUM(c - 1) as count FROM (
    SELECT COUNT(*) as c FROM t_cartes ${w}
    GROUP BY noms, prenoms, date_de_naissance
    HAVING noms IS NOT NULL AND COUNT(DISTINCT cle_doublon) > 1
  )`;
const doublonsStricts = (w: string) => `
  SELECT SUM(c - 1) as count FROM (
    SELECT COUNT(*) as c FROM t_cartes ${w}
    GROUP BY cle_doublon
    HAVING cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||' AND COUNT(*) > 1
  )`;

beforeAll(async () => {
  schema = await import('../src/main/database/schema');
  const dir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'gest_in_situ.db'));
  db.pragma('journal_mode = WAL');
  schema.runMigrations(db);

  db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_V73', 'SITE_V73', 1, 'site-v73')`).run(SITE);
  for (const c of CENTRES) {
    db.prepare(`INSERT INTO t_centres (id, site_id, nom, sync_id) VALUES (?, ?, ?, ?)`).run(c, SITE, `CENTRE_V73_${c}`, `centre-v73-${c}`);
  }
  const ins = db.prepare(
    `INSERT INTO t_cartes (site_id, centre_id, noms, prenoms, date_de_naissance, cle_doublon, statut, sync_id, is_dirty)
     VALUES (?, ?, ?, ?, ?, ?, 'EN STOCK', ?, 0)`
  );
  db.transaction(() => {
    for (let i = 0; i < 8000; i++) {
      const centre = CENTRES[i % CENTRES.length];
      const nom = `NOM${i % 1500}`;
      const pre = `PRE${i % 97}`;
      const dob = `19${String(60 + (i % 40)).padStart(2, '0')}-0${1 + (i % 9)}-1${i % 9}`;
      ins.run(SITE, centre, nom, pre, dob, `${nom}|${pre}|${dob}|${i % 5}`, `v73-${i}`);
    }
  })();
  db.exec('ANALYZE');
}, 60000);

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Migration V73 — idx_cartes_stats_dp_centre', () => {
  it('SCHEMA_VERSION = 73 et installation neuve : index créé, user_version estampillé', () => {
    expect(schema.SCHEMA_VERSION).toBe(73);
    expect(db.pragma('user_version', { simple: true })).toBe(73);
    expect(indexNames(db)).toContain(INDEX);
    const cols = (db.prepare(`PRAGMA index_info(${INDEX})`).all() as { name: string }[]).map(c => c.name);
    expect(cols).toEqual(['site_id', 'centre_id', 'noms', 'prenoms', 'date_de_naissance', 'cle_doublon']);
  });

  it('idempotente : migrateV73 rejouée ne lève rien, ne duplique rien, ne modifie aucune donnée', () => {
    const avant = (db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c;
    expect(() => schema.migrateV73(db)).not.toThrow();
    expect(() => schema.migrateV73(db)).not.toThrow();
    expect(indexNames(db).filter(n => n === INDEX)).toHaveLength(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c).toBe(avant);
  });

  it('base V72 existante : runMigrations (V72 → V73) crée l\'index sans toucher aux données', () => {
    db.exec(`DROP INDEX ${INDEX}`);
    db.pragma('user_version = 72');
    const avant = (db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c;
    expect(indexNames(db)).not.toContain(INDEX);

    expect(() => schema.runMigrations(db)).not.toThrow();

    expect(indexNames(db)).toContain(INDEX);
    expect(db.pragma('user_version', { simple: true })).toBe(73);
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c).toBe(avant);
  });

  it('filet V66 : index manquant sur une base déjà estampillée 73 → recréé au démarrage suivant', () => {
    db.exec(`DROP INDEX ${INDEX}`);
    expect(() => schema.runMigrations(db)).not.toThrow();
    expect(indexNames(db)).toContain(INDEX);
  });

  it('plan doublons probables AVEC centre : utilise idx_cartes_stats_dp_centre (couvrant)', () => {
    db.exec('ANALYZE');
    const p = plan(doublonsProbables(WHERE_CENTRE), { siteId: SITE, centreId: 3 });
    expect(p).toContain(INDEX);
    expect(p).toMatch(/COVERING INDEX/i);
  });

  it('plan doublons stricts AVEC centre : n\'utilise pas un scan de table complet', () => {
    const p = plan(doublonsStricts(WHERE_CENTRE), { siteId: SITE, centreId: 3 });
    expect(p).not.toMatch(/SCAN t_cartes(?! USING)/);
    expect(p).toMatch(/INDEX/i);
  });

  it('plans SANS centre (vue site) : doublons probables reste sur idx_cartes_stats_dp_v2 couvrant, stricts inchangé, aucun scan table', () => {
    const probables = plan(doublonsProbables(WHERE_SITE), { siteId: SITE });
    const stricts = plan(doublonsStricts(WHERE_SITE), { siteId: SITE });
    expect(probables).toMatch(/COVERING INDEX idx_cartes_stats_dp_v2/i);
    expect(probables).not.toContain(INDEX);
    expect(stricts).not.toContain(INDEX);
    expect(probables).not.toMatch(/SCAN t_cartes(?! USING)/);
    expect(stricts).not.toMatch(/SCAN t_cartes(?! USING)/);
    expect(stricts).toMatch(/INDEX/i);
  });

  it('résultats identiques avec ou sans index (aucun effet fonctionnel)', () => {
    const run = () => ({
      p: db.prepare(doublonsProbables(WHERE_CENTRE)).get({ siteId: SITE, centreId: 3 }),
      s: db.prepare(doublonsStricts(WHERE_CENTRE)).get({ siteId: SITE, centreId: 3 }),
      ps: db.prepare(doublonsProbables(WHERE_SITE)).get({ siteId: SITE }),
    });
    const avecIndex = run();
    db.exec(`DROP INDEX ${INDEX}`);
    const sansIndex = run();
    schema.migrateV73(db);
    expect(avecIndex).toEqual(sansIndex);
  });
});
