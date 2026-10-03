import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * P0-B (audit Phase 1 du 27/09/2026) — seconde délivrance d'une carte.
 *
 * Avant correctif, delivrerCarte() (src/main/database/queries/cartes.queries.ts) ne bloquait
 * que le statut DOUBLON : un second appel sur une carte DELIVRE écrasait nom_retirant,
 * num_retirant et date_delivrance (preuve de retrait). Décision utilisateur validée : seule
 * une carte EN STOCK est délivrable.
 *
 * Exerce la vraie fonction contre une base SQLite jetable (migrations de production via
 * initDatabase), jamais la base réelle. Synchro réseau coupée (GEST_IN_SITU_E2E_DISABLE_SYNC).
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-p0b-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('delivrerCarte() — garde anti-seconde délivrance (P0-B)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;

  const SITE_ID = 910;
  const operateur = { role: 'OPERATEUR_VERIFICATION', site_id: SITE_ID, centre_id: 0, id_user: 1, login: 'op.test' };

  const premier = { nom_retirant: 'RETIRANT UN', num_retirant: 'PIECE-1', agent_distributeur: 'op.test', rangement: 'R-1' };
  const second = { nom_retirant: 'RETIRANT DEUX', num_retirant: 'PIECE-2', agent_distributeur: 'op.autre', rangement: 'R-2' };

  function insertCarte(statut: string, suffix: string): number {
    return Number(db.prepare(`
      INSERT INTO t_cartes (site_id, centre_id, noms, prenoms, date_de_naissance, rangement, statut, sync_id, is_dirty)
      VALUES (?, ?, 'TEST', ?, '1990-01-01', 'R-1', ?, ?, 0)
    `).run(SITE_ID, operateur.centre_id, `CARTE_${suffix}`, statut, `sync-p0b-${suffix}`).lastInsertRowid);
  }

  const outboxCount = (syncId: string) =>
    (db.prepare('SELECT COUNT(*) AS c FROM t_outbox WHERE id = ?').get(syncId) as { c: number }).c;
  const logsCount = () => (db.prepare('SELECT COUNT(*) AS c FROM t_logs').get() as { c: number }).c;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_P0B', 'SITE_P0B', 1, 'site-p0b')`).run(SITE_ID);
    operateur.centre_id = Number(db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'CENTRE_P0B', 'centre-p0b')`)
      .run(SITE_ID).lastInsertRowid);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1ʳᵉ délivrance OK, 2ᵉ refusée, preuve de retrait et outbox inchangées', () => {
    const id = insertCarte('EN STOCK', 'A');

    queries.delivrerCarte(id, premier, operateur);
    const apres1 = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
    expect(apres1.statut).toBe('DELIVRE');
    expect(apres1.nom_retirant).toBe('RETIRANT UN');
    expect(apres1.is_dirty).toBe(1);
    expect(outboxCount('sync-p0b-A')).toBe(1);
    const outbox1 = db.prepare('SELECT payload, status FROM t_outbox WHERE id = ?').get('sync-p0b-A') as any;
    const logsAvant = logsCount();

    expect(() => queries.delivrerCarte(id, second, operateur)).toThrow(/déjà été délivrée/);

    const apres2 = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
    expect(apres2).toEqual(apres1); // aucune colonne modifiée (retirant, date, rangement, updated_at…)
    expect(outboxCount('sync-p0b-A')).toBe(1);
    expect(db.prepare('SELECT payload, status FROM t_outbox WHERE id = ?').get('sync-p0b-A')).toEqual(outbox1);
    expect(logsCount()).toBe(logsAvant);
  });

  it.each(['ANNULE', 'BROUILLON', 'RETIRE', 'DISTRIBUEE'])('refuse la délivrance d\'une carte %s sans rien écrire', (statut) => {
    const id = insertCarte(statut, `S_${statut}`);
    const avant = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id);
    expect(() => queries.delivrerCarte(id, premier, operateur)).toThrow(/ne peut pas être délivrée/);
    expect(db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id)).toEqual(avant);
    expect(outboxCount(`sync-p0b-S_${statut}`)).toBe(0);
  });

  it('DOUBLON : message historique conservé', () => {
    const id = insertCarte('DOUBLON', 'D');
    expect(() => queries.delivrerCarte(id, premier, operateur)).toThrow(/déclarée en doublon/);
    expect(outboxCount('sync-p0b-D')).toBe(0);
  });

  it('cloisonnement conservé : carte d\'un autre site refusée', () => {
    const id = insertCarte('EN STOCK', 'X');
    expect(() => queries.delivrerCarte(id, premier, { ...operateur, site_id: SITE_ID + 1 })).toThrow();
    expect((db.prepare('SELECT statut FROM t_cartes WHERE id_carte = ?').get(id) as any).statut).toBe('EN STOCK');
  });
});
