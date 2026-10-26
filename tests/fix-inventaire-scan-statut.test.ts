import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 10) — updateCarteRangementAndStatusRapid() (scan d'inventaire) ne doit
 * plus remettre en 'EN STOCK' une carte DELIVRE/DOUBLON/supprimée, ni choisir au hasard entre
 * deux cartes de même num_secu. Refus = aucune écriture (t_cartes, t_outbox, t_logs).
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-scanstatut-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('updateCarteRangementAndStatusRapid() — refus hors EN STOCK', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 930;
  const user = { role: 'OPERATEUR_INVENTAIRE', site_id: SITE_ID, id_user: 1, login: 'op.scan' };
  let seq = 0;

  function insertCarte(statut: string, numSecu: string, isDirty = 0): number {
    seq++;
    return Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, rangement, statut, num_secu, sync_id, is_dirty)
      VALUES (?, 'TEST', ?, '1990-01-01', 'R-OLD', ?, ?, ?, ?)
    `).run(SITE_ID, `P${seq}`, statut, numSecu, `sync-scan-${seq}`, isDirty).lastInsertRowid);
  }
  const snapshot = () => ({
    cartes: db.prepare('SELECT * FROM t_cartes ORDER BY id_carte').all(),
    outbox: db.prepare('SELECT * FROM t_outbox ORDER BY rowid').all(),
    logs: db.prepare('SELECT COUNT(*) AS c FROM t_logs').get()
  });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_SC', 'SITE_SC', 1, 'site-sc')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('carte DELIVRE : refus, aucune écriture', () => {
    insertCarte('DELIVRE', '1000000000001');
    const avant = snapshot();
    const res: any = queries.updateCarteRangementAndStatusRapid('1000000000001', 'R-NEW', user);
    expect(res.success).toBe(false);
    expect(res.message).toContain('Carte au statut DELIVRE');
    expect(snapshot()).toEqual(avant);
  });

  it('carte DOUBLON : refus, aucune écriture', () => {
    insertCarte('DOUBLON', '1000000000002');
    const avant = snapshot();
    const res: any = queries.updateCarteRangementAndStatusRapid('1000000000002', 'R-NEW', user);
    expect(res.success).toBe(false);
    expect(res.message).toContain('Carte au statut DOUBLON');
    expect(snapshot()).toEqual(avant);
  });

  it('carte supprimée (is_dirty=-1) : introuvable, aucune écriture', () => {
    insertCarte('EN STOCK', '2000000000001', -1);
    const avant = snapshot();
    const res: any = queries.updateCarteRangementAndStatusRapid('2000000000001', 'R-NEW', user);
    expect(res.success).toBe(false);
    expect(snapshot()).toEqual(avant);
  });

  it('deux cartes de même num_secu : refus, aucune écriture', () => {
    insertCarte('EN STOCK', '3000000000001');
    insertCarte('EN STOCK', '3000000000001');
    const avant = snapshot();
    const res: any = queries.updateCarteRangementAndStatusRapid('3000000000001', 'R-NEW', user);
    expect(res.success).toBe(false);
    expect(res.message).toContain('Plusieurs cartes');
    expect(snapshot()).toEqual(avant);
  });

  it("une carte supprimée + une active de même num_secu : l'active est traitée", () => {
    insertCarte('EN STOCK', '4000000000001', -1);
    const id = insertCarte('EN STOCK', '4000000000001');
    const res: any = queries.updateCarteRangementAndStatusRapid('4000000000001', 'R-NEW', user);
    expect(res.success).toBe(true);
    expect((db.prepare('SELECT rangement FROM t_cartes WHERE id_carte = ?').get(id) as any).rangement).toBe('R-NEW');
  });

  it('carte EN STOCK : succès comme avant (rangement, is_dirty=1, outbox)', () => {
    const id = insertCarte('EN STOCK', '5000000000001');
    const res: any = queries.updateCarteRangementAndStatusRapid('5000000000001', 'r-new2', user);
    expect(res.success).toBe(true);
    const c = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
    expect(c.rangement).toBe('R-NEW2');
    expect(c.statut).toBe('EN STOCK');
    expect(c.is_dirty).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM t_outbox WHERE id = ?').get(c.sync_id) as any).n).toBe(1);
  });
});
