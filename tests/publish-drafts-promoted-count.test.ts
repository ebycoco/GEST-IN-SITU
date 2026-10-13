import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

/**
 * T2 — publishDrafts() : compteur promotedCount (brouillons réellement passés de BROUILLON à
 * EN STOCK dans la transaction), distinct de publishedCount (qui inclut aussi les cartes déjà
 * EN STOCK encore is_dirty=1 ré-enfilées dans l'outbox).
 *
 * Exerce la vraie fonction contre une base SQLite jetable (migrations de production via
 * initDatabase), jamais la base réelle. Synchro réseau coupée (GEST_IN_SITU_E2E_DISABLE_SYNC),
 * NetworkMonitor jamais démarré (état OFFLINE) : scheduleOutboxProcessing n'est jamais appelé.
 *
 * Journal : sous vitest, electron-log charge sa variante Node, qui ignore le mock `electron` et
 * écrirait par défaut dans %APPDATA%\<nom du package>\logs\main.log (journal réel de l'appli).
 * Le transport fichier est donc désactivé ET redirigé vers le dossier temporaire de T2, avant tout
 * import des modules testés (importés dynamiquement dans beforeAll). electron-log, sous
 * node_modules, est externalisé par vitest (cache de modules natif partagé) : même instance que
 * celle des modules testés — vérifié à l'exécution par la sonde `t2probe` ci-dessous.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-t2-'));

log.transports.file.level = false;
log.transports.file.resolvePathFn = () => path.join(tmpDir, 't2.log');
let probeCount = 0;
const probe = Object.assign(() => { probeCount++; }, { level: 'silly' as const });
(log.transports as unknown as Record<string, unknown>).t2probe = probe;

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('publishDrafts() — compteur promotedCount (T2)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;

  const SITE_ID = 920;
  const AUTRE_SITE_ID = 921;
  let centreId = 0;

  function insertCarte(opts: { site?: number; user: number; statut: string; ddn: string | null; dirty: number; suffix: string }): number {
    return Number(db.prepare(`
      INSERT INTO t_cartes (site_id, centre_id, noms, prenoms, date_de_naissance, rangement, statut, sync_id, is_dirty, created_by)
      VALUES (?, ?, 'T2', ?, ?, 'R-T2', ?, ?, ?, ?)
    `).run(opts.site ?? SITE_ID, centreId, `CARTE_${opts.suffix}`, opts.ddn, opts.statut, `sync-t2-${opts.suffix}`, opts.dirty, opts.user).lastInsertRowid);
  }

  const statutOf = (id: number) => (db.prepare('SELECT statut FROM t_cartes WHERE id_carte = ?').get(id) as { statut: string }).statut;
  const outboxRow = (suffix: string) =>
    db.prepare('SELECT operation, status, payload FROM t_outbox WHERE id = ?').get(`sync-t2-${suffix}`) as { operation: string; status: string; payload: string } | undefined;
  const outboxTotal = () => (db.prepare('SELECT COUNT(*) AS c FROM t_outbox').get() as { c: number }).c;
  const logsTotal = () => (db.prepare('SELECT COUNT(*) AS c FROM t_logs').get() as { c: number }).c;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    // Garde-fou : la base doit se trouver dans le dossier temporaire de T2, jamais ailleurs.
    const dbPath = path.resolve(connection.getDbPath());
    if (!dbPath.startsWith(path.resolve(tmpDir) + path.sep)) {
      throw new Error(`T2 interrompu : base hors du dossier temporaire (${dbPath})`);
    }
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    // Preuve que les modules testés journalisent via la même instance electron-log (sonde).
    if (probeCount === 0) {
      throw new Error('T2 interrompu : instance electron-log des modules testés non interceptée.');
    }
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_T2', 'SITE_T2', 1, 'site-t2')`).run(SITE_ID);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_T2B', 'SITE_T2B', 1, 'site-t2b')`).run(AUTRE_SITE_ID);
    centreId = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'CENTRE_T2', 'centre-t2')`).run(SITE_ID).lastInsertRowid);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('C1 — aucune carte : retour anticipé à 0/0/0', () => {
    const outboxAvant = outboxTotal();
    expect(queries.publishDrafts(SITE_ID, 101)).toEqual({ publishedCount: 0, skippedInvalidDateCount: 0, promotedCount: 0 });
    expect(outboxTotal()).toBe(outboxAvant);
  });

  it('C1b — uniquement des cartes is_dirty=0 (dont un BROUILLON) : retour anticipé à 0/0/0', () => {
    const b = insertCarte({ user: 102, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 0, suffix: 'C1b-B' });
    const s = insertCarte({ user: 102, statut: 'EN STOCK', ddn: '1990-01-01', dirty: 0, suffix: 'C1b-S' });
    expect(queries.publishDrafts(SITE_ID, 102)).toEqual({ publishedCount: 0, skippedInvalidDateCount: 0, promotedCount: 0 });
    expect(statutOf(b)).toBe('BROUILLON');
    expect(statutOf(s)).toBe('EN STOCK');
  });

  it('C2 — un brouillon valide : promu, enfilé dans l\'outbox', () => {
    const logsAvant = logsTotal();
    const id = insertCarte({ user: 103, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C2' });
    expect(queries.publishDrafts(SITE_ID, 103)).toEqual({ publishedCount: 1, skippedInvalidDateCount: 0, promotedCount: 1 });
    const row = db.prepare('SELECT statut, updated_at, action_at FROM t_cartes WHERE id_carte = ?').get(id) as any;
    expect(row.statut).toBe('EN STOCK');
    expect(row.updated_at).toBeTruthy();
    expect(row.action_at).toBeTruthy();
    const ob = outboxRow('C2');
    expect(ob?.operation).toBe('UPDATE');
    expect(ob?.status).toBe('PENDING');
    expect(JSON.parse(ob!.payload).statut).toBe('EN STOCK');
    expect(logsTotal()).toBe(logsAvant); // comportement existant : publishDrafts n'écrit pas dans t_logs
  });

  it('C3 — plusieurs brouillons valides : tous promus', () => {
    const ids = ['C3-1', 'C3-2', 'C3-3'].map((s) => insertCarte({ user: 104, statut: 'BROUILLON', ddn: '1985-06-15', dirty: 1, suffix: s }));
    expect(queries.publishDrafts(SITE_ID, 104)).toEqual({ publishedCount: 3, skippedInvalidDateCount: 0, promotedCount: 3 });
    ids.forEach((id) => expect(statutOf(id)).toBe('EN STOCK'));
    ['C3-1', 'C3-2', 'C3-3'].forEach((s) => expect(outboxRow(s)).toBeDefined());
  });

  it('C4 — carte déjà EN STOCK et is_dirty=1 : ré-enfilée mais non promue', () => {
    const id = insertCarte({ user: 105, statut: 'EN STOCK', ddn: '1990-01-01', dirty: 1, suffix: 'C4' });
    expect(queries.publishDrafts(SITE_ID, 105)).toEqual({ publishedCount: 1, skippedInvalidDateCount: 0, promotedCount: 0 });
    expect(statutOf(id)).toBe('EN STOCK');
    expect(outboxRow('C4')).toBeDefined();
  });

  it('C4b — un brouillon valide + une carte EN STOCK is_dirty=1 : 1 promu, 2 publiés', () => {
    const b = insertCarte({ user: 106, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C4b-B' });
    insertCarte({ user: 106, statut: 'EN STOCK', ddn: '1990-01-01', dirty: 1, suffix: 'C4b-S' });
    expect(queries.publishDrafts(SITE_ID, 106)).toEqual({ publishedCount: 2, skippedInvalidDateCount: 0, promotedCount: 1 });
    expect(statutOf(b)).toBe('EN STOCK');
  });

  it('C5 — un brouillon valide + un brouillon à date invalide : 1 promu, 1 ignoré', () => {
    const ok = insertCarte({ user: 107, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C5-OK' });
    const ko = insertCarte({ user: 107, statut: 'BROUILLON', ddn: '1990-02-30', dirty: 1, suffix: 'C5-KO' });
    expect(queries.publishDrafts(SITE_ID, 107)).toEqual({ publishedCount: 1, skippedInvalidDateCount: 1, promotedCount: 1 });
    expect(statutOf(ok)).toBe('EN STOCK');
    expect(statutOf(ko)).toBe('BROUILLON');
    expect(outboxRow('C5-KO')).toBeUndefined();
  });

  it('C5b — uniquement des brouillons invalides (vide, JJ/MM/AAAA, NULL) : aucun promu', () => {
    const ids = [
      insertCarte({ user: 108, statut: 'BROUILLON', ddn: '', dirty: 1, suffix: 'C5b-1' }),
      insertCarte({ user: 108, statut: 'BROUILLON', ddn: '31/12/1990', dirty: 1, suffix: 'C5b-2' }),
      insertCarte({ user: 108, statut: 'BROUILLON', ddn: null, dirty: 1, suffix: 'C5b-3' })
    ];
    expect(queries.publishDrafts(SITE_ID, 108)).toEqual({ publishedCount: 0, skippedInvalidDateCount: 3, promotedCount: 0 });
    ids.forEach((id) => expect(statutOf(id)).toBe('BROUILLON'));
    ['C5b-1', 'C5b-2', 'C5b-3'].forEach((s) => expect(outboxRow(s)).toBeUndefined());
  });

  it('C6 — cloisonnement : autre site / autre agent ni promus ni comptés', () => {
    const mien = insertCarte({ user: 109, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C6-MIEN' });
    const autreSite = insertCarte({ site: AUTRE_SITE_ID, user: 109, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C6-SITE' });
    const autreAgent = insertCarte({ user: 1090, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C6-AGENT' });
    expect(queries.publishDrafts(SITE_ID, 109)).toEqual({ publishedCount: 1, skippedInvalidDateCount: 0, promotedCount: 1 });
    expect(statutOf(mien)).toBe('EN STOCK');
    expect(statutOf(autreSite)).toBe('BROUILLON');
    expect(statutOf(autreAgent)).toBe('BROUILLON');
  });

  it('C7 — second appel après C2 : la carte déjà promue est republiée mais pas re-promue', () => {
    expect(queries.publishDrafts(SITE_ID, 103)).toEqual({ publishedCount: 1, skippedInvalidDateCount: 0, promotedCount: 0 });
  });

  it('C8/C8b — erreur dans la transaction : rollback complet, puis reprise normale', () => {
    const a = insertCarte({ user: 110, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C8-1' });
    const b = insertCarte({ user: 110, statut: 'BROUILLON', ddn: '1990-01-01', dirty: 1, suffix: 'C8-2' });
    // Déclencheur temporaire propre à la connexion de test (base jetable), jamais en production.
    db.exec(`CREATE TEMP TRIGGER t2_fail BEFORE UPDATE OF statut ON t_cartes
      WHEN OLD.sync_id = 'sync-t2-C8-2' BEGIN SELECT RAISE(ABORT, 'T2 simulated failure'); END;`);
    try {
      expect(() => queries.publishDrafts(SITE_ID, 110)).toThrow(/T2 simulated failure/);
      expect(statutOf(a)).toBe('BROUILLON');
      expect(statutOf(b)).toBe('BROUILLON');
      expect(outboxRow('C8-1')).toBeUndefined();
      expect(outboxRow('C8-2')).toBeUndefined();
    } finally {
      db.exec('DROP TRIGGER IF EXISTS t2_fail;');
    }
    expect(queries.publishDrafts(SITE_ID, 110)).toEqual({ publishedCount: 2, skippedInvalidDateCount: 0, promotedCount: 2 });
    expect(statutOf(a)).toBe('EN STOCK');
    expect(statutOf(b)).toBe('EN STOCK');
  });
});
