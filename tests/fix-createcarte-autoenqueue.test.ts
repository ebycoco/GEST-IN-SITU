import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 11) — createCarte() doit enfiler automatiquement la saisie finale
 * dans t_outbox (comme les corrections Qualité), sauf pour un BROUILLON (publishDrafts s'en
 * charge) et sauf doublon probable. Base SQLite jetable, aucun réseau (sync désactivée).
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-createcarte-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('createCarte() — enfilage automatique dans t_outbox', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 920;

  const outboxRows = (syncId: string) =>
    db.prepare("SELECT * FROM t_outbox WHERE id = ? AND table_name = 't_cartes'").all(syncId) as any[];

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CC', 'SITE_CC', 1, 'site-cc')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a)+(d) saisie finale : une ligne t_outbox (id = sync_id), carte is_dirty=1 conservé', () => {
    const res = queries.createCarte(
      { noms: 'KOUASSI', prenoms: 'AMON', date_de_naissance: '1990-01-01', lieu_de_naissance: 'ABOBO', contact: '0102030405', statut: 'EN STOCK', rangement: 'A-1' },
      SITE_ID
    );
    const rows = outboxRows(res.sync_id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('PENDING');
    const carte = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(Number(res.id)) as any;
    expect(carte.is_dirty).toBe(1);
  });

  it('(b) BROUILLON : aucune ligne t_outbox', () => {
    const res = queries.createCarte({ noms: 'BROUILLON', prenoms: 'UN', statut: 'BROUILLON' }, SITE_ID);
    expect(outboxRows(res.sync_id).length).toBe(0);
    const carte = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(Number(res.id)) as any;
    expect(carte.is_dirty).toBe(1);
  });

  it("(c) doublon probable : pas d'entrée outbox, is_dirty=1 conservé", () => {
    const base = { noms: 'TRAORE', prenoms: 'AWA', date_de_naissance: '1985-05-05', contact: '0707070707', statut: 'EN STOCK' };
    const first = queries.createCarte({ ...base, lieu_de_naissance: 'ABOBO' }, SITE_ID);
    expect(outboxRows(first.sync_id).length).toBe(1);
    const second = queries.createCarte({ ...base, lieu_de_naissance: 'YOPOUGON' }, SITE_ID);
    expect(outboxRows(second.sync_id).length).toBe(0);
    const carte = db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(Number(second.id)) as any;
    expect(carte.is_dirty).toBe(1);
  });
});
