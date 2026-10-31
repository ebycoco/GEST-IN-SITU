import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Compteur des envois reportés par la garde d'alignement (« [NON ALIGNÉ] ») pour le tableau de synchro —
 * décision utilisateur 2026-10-31 : compteur visible seul. Seules les entrées PENDING portant ce motif comptent.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-misaligned-count-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('getOutboxMisalignedCount', () => {
  let connection: typeof import('../src/main/database/connection');
  let outbox: typeof import('../src/main/sync/outbox.service');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    outbox = await import('../src/main/sync/outbox.service');
    db = await connection.initDatabase();
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const add = (id: string, status: string, errorMsg: string | null) =>
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status, error_msg) VALUES (?, 't_logs', 'INSERT', '{}', ?, ?)`).run(id, status, errorMsg);

  it('compte uniquement les PENDING reportées « [NON ALIGNÉ] », toutes tables confondues', () => {
    expect(outbox.getOutboxMisalignedCount()).toBe(0);

    add('na-1', 'PENDING', `${outbox.NOT_ALIGNED_PREFIX} site local 7 non aligné sur le cloud — envoi reporté.`);
    add('na-2', 'PENDING', `${outbox.NOT_ALIGNED_PREFIX} vérification du centre 3 dans le cloud impossible (réseau) — envoi reporté.`);
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status, error_msg) VALUES ('na-cartes', 't_cartes', 'UPDATE', '{}', 'PENDING', ?)`)
      .run(`${outbox.NOT_ALIGNED_PREFIX} centre local 3 pas encore envoyé au cloud — envoi reporté.`);

    add('ok-null', 'PENDING', null);
    add('ok-autre', 'PENDING', 'Erreur réseau transitoire');
    add('err-na', 'ERROR', `${outbox.NOT_ALIGNED_PREFIX} ancien motif resté sur une entrée en erreur`);
    add('synced-na', 'SYNCED', `${outbox.NOT_ALIGNED_PREFIX} déjà envoyée`);

    expect(outbox.getOutboxMisalignedCount()).toBe(3);

    db.prepare(`UPDATE t_outbox SET status = 'SYNCED', error_msg = NULL WHERE id = 'na-1'`).run();
    expect(outbox.getOutboxMisalignedCount()).toBe(2);
  });
});
