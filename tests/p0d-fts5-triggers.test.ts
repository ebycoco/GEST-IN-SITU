import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

/**
 * P0-D (audit Phase 1 du 27/09/2026) — dérive / corruption des index FTS5 à contenu externe.
 *
 * Cause démontrée : les triggers retiraient les lignes de l'index par `DELETE FROM fts WHERE
 * rowid = ...` au lieu de la commande canonique `VALUES('delete', old.rowid, old.cols...)`.
 * La migration V71 (schema.ts) installe les définitions canoniques ; fts-maintenance.ts
 * fournit contrôle strict + reconstruction explicite.
 *
 * Bases jetables uniquement (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-p0d-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const LEGACY_TRIGGERS = `
  DROP TRIGGER IF EXISTS trg_cartes_ad;
  DROP TRIGGER IF EXISTS trg_cartes_au;
  CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
    DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
  END;
  CREATE TRIGGER trg_cartes_au AFTER UPDATE OF noms, prenoms, num_secu, contact, lieu_de_naissance, rangement ON t_cartes BEGIN
    DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
    INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
    VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
  END;
`;

describe('FTS5 — triggers canoniques V71 + maintenance (P0-D)', () => {
  let connection: typeof import('../src/main/database/connection');
  let schema: typeof import('../src/main/database/schema');
  let fts: typeof import('../src/main/database/fts-maintenance');
  let db: Database.Database;
  const SITE_ID = 920;

  const match = (d: Database.Database, q: string) =>
    (d.prepare('SELECT COUNT(*) AS c FROM t_cartes_fts WHERE t_cartes_fts MATCH ?').get(q) as { c: number }).c;
  const seed = (d: Database.Database, n: number) => {
    const ins = d.prepare(`INSERT INTO t_cartes (site_id, noms, prenoms, rangement, sync_id) VALUES (?, ?, ?, ?, ?)`);
    d.transaction(() => { for (let i = 0; i < n; i++) ins.run(SITE_ID, `NOM${i % 40}`, `PRENOM${i % 60}`, `AAA-${i % 25}`, `sync-p0d-${Math.random()}`); })();
  };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    schema = await import('../src/main/database/schema');
    fts = await import('../src/main/database/fts-maintenance');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_P0D', 'SITE_P0D', 1, 'site-p0d')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installation neuve : SCHEMA_VERSION 71 et triggers canoniques en place', () => {
    expect(schema.SCHEMA_VERSION).toBe(71);
    expect(db.pragma('user_version', { simple: true })).toBe(71);
    const sql = (name: string) => (db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).get(name) as { sql: string }).sql;
    for (const t of ['trg_cartes_ad', 'trg_cartes_au', 'trg_anomalies_ad', 'trg_anomalies_au']) {
      expect(sql(t)).toMatch(/VALUES \('delete'/);
      expect(sql(t)).not.toMatch(/DELETE FROM t_(cartes|anomalies)_fts/);
    }
    expect(sql('trg_cartes_au')).toMatch(/AFTER UPDATE OF noms, prenoms, num_secu, contact, lieu_de_naissance, rangement/);
  });

  it('cycle insertion → modification → rangement → suppression → réinsertion → recherche : index strict OK', () => {
    seed(db, 1500);
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts').ok).toBe(true);

    const ids = (db.prepare('SELECT id_carte FROM t_cartes WHERE site_id = ? ORDER BY id_carte').all(SITE_ID) as { id_carte: number }[]).map(r => r.id_carte);
    const upd = db.prepare('UPDATE t_cartes SET noms = ? WHERE id_carte = ?');
    const rng = db.prepare('UPDATE t_cartes SET rangement = ? WHERE id_carte = ?');
    db.transaction(() => {
      ids.slice(0, 300).forEach(id => upd.run('NOUVEAUNOM', id));
      ids.slice(300, 800).forEach(id => rng.run('BBB-9', id));
    })();
    db.prepare(`DELETE FROM t_cartes WHERE id_carte IN (${ids.slice(800, 900).join(',')})`).run();
    seed(db, 50);

    expect(fts.checkFtsIntegrity(db, 't_cartes_fts').ok).toBe(true);
    expect(match(db, 'noms:NOUVEAUNOM')).toBe(300);
    expect(match(db, 'rangement:BBB')).toBe(500);
    // Aucun fantôme : les jetons AAA ne subsistent que pour les lignes qui les portent réellement.
    const reelsAAA = (db.prepare(`SELECT COUNT(*) AS c FROM t_cartes WHERE rangement LIKE 'AAA-%'`).get() as { c: number }).c;
    expect(match(db, 'rangement:AAA')).toBe(reelsAAA);
  });

  it('anomalies d\'import : modification et suppression gardent t_anomalies_fts cohérent', () => {
    const ins = db.prepare(`INSERT INTO t_import_anomalies (site_id, noms, prenoms, rangement) VALUES (?, 'ANO', 'P', 'OLD')`);
    const idA = Number(ins.run(SITE_ID).lastInsertRowid);
    const idB = Number(ins.run(SITE_ID).lastInsertRowid);
    db.prepare(`UPDATE t_import_anomalies SET rangement = 'NEWR' WHERE id = ?`).run(idA);
    db.prepare(`DELETE FROM t_import_anomalies WHERE id = ?`).run(idB);
    expect(fts.checkFtsIntegrity(db, 't_anomalies_fts').ok).toBe(true);
  });

  it('base héritée V70 : dérive FTS5 → V71 → reconstruction contrôlée → strict OK, données t_cartes inchangées', () => {
    const legacyPath = path.join(tmpDir, 'legacy.db');
    const legacy = new Database(legacyPath);
    // Mêmes pragmas que connection.ts (sans eux, chaque migration fait un fsync complet : ~15 s).
    legacy.pragma('journal_mode = WAL');
    legacy.pragma('synchronous = NORMAL');
    // Reproduit une base existante : schéma complet, puis anciens triggers et user_version 70.
    schema.runMigrations(legacy);
    legacy.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S', 'S', 1, 's-legacy')`).run(SITE_ID);
    legacy.exec(LEGACY_TRIGGERS);
    legacy.pragma('user_version = 70');
    seed(legacy, 1200);
    const ids = (legacy.prepare('SELECT id_carte FROM t_cartes ORDER BY id_carte').all() as { id_carte: number }[]).map(r => r.id_carte);
    const rng = legacy.prepare('UPDATE t_cartes SET rangement = ? WHERE id_carte = ?');
    legacy.transaction(() => ids.slice(0, 600).forEach(id => rng.run('ZZZ-1', id)))();

    const avant = fts.checkFtsIntegrity(legacy, 't_cartes_fts');
    expect(avant.ok).toBe(false);
    expect(avant.error).toMatch(/malformed/);
    expect(fts.checkFtsIntegrity(legacy, 't_cartes_fts', false).ok).toBe(true); // le contrôle de démarrage ne voit rien

    const nbCartes = (legacy.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c;
    // Contrat décidé : V71 + dérive FTS5 seule → reconstruction contrôlée par la migration elle-même.
    schema.runMigrations(legacy);
    expect(legacy.pragma('user_version', { simple: true })).toBe(71);
    expect(fts.checkFtsIntegrity(legacy, 't_cartes_fts', true).ok).toBe(true);
    expect(fts.checkFtsIntegrity(legacy, 't_anomalies_fts', true).ok).toBe(true);
    expect((legacy.prepare('SELECT COUNT(*) AS c FROM t_cartes').get() as { c: number }).c).toBe(nbCartes);
    expect(match(legacy, 'rangement:ZZZ')).toBe(600);

    // Après V71, de nouvelles mutations ne recréent pas de dérive.
    legacy.transaction(() => ids.slice(600, 900).forEach(id => rng.run('YYY-2', id)))();
    expect(fts.checkFtsIntegrity(legacy, 't_cartes_fts').ok).toBe(true);
    legacy.close();
  });

  it('nuclearResetFts5 recrée les triggers canoniques (plus de réintroduction de la dérive)', async () => {
    const queries = await import('../src/main/database/queries/cartes.queries');
    queries.nuclearResetFts5();
    await new Promise(r => setImmediate(r));
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_cartes_au'`).get() as { sql: string }).sql;
    expect(sql).toMatch(/VALUES \('delete'/);
    expect(fts.checkFtsIntegrity(db, 't_cartes_fts').ok).toBe(true);
  });
});
