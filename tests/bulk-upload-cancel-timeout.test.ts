import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Audit du commit 7 (fbec916), P1-2 — envoi en masse :
 * - le contrôle d'alignement cloud a un délai maximal (réseau bloqué = refus motivé, pas d'attente sans fin) ;
 * - une annulation pendant ce contrôle est retenue (le worker ne démarre pas) ;
 * - une annulation pendant l'envoi conclut bien la promesse (avant : _currentWorker remis à null par
 *   cancelBulkUpload, le gestionnaire 'exit' ne résolvait jamais) ;
 * - une annulation sans envoi en cours n'affecte pas l'envoi suivant.
 */

const h = vi.hoisted(() => ({
  check: null as null | ((siteId: number, centreIds: ReadonlyArray<number>) => Promise<{ ok: true } | { ok: false; reason: string }>),
  workers: [] as any[]
}));

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/main/database/connection', () => ({
  getDbPath: () => ':memory:',
  getDatabase: () => ({ prepare: () => ({ all: () => [] }) })
}));
vi.mock('../src/main/sync/network-monitor', () => ({ networkMonitor: { setBypassForceOnline: vi.fn() } }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../src/main/sync/outbox.service', () => ({
  checkHierarchyAlignmentForUpload: (siteId: number, centreIds: ReadonlyArray<number>) => h.check!(siteId, centreIds)
}));
vi.mock('worker_threads', async () => {
  const { EventEmitter: EE } = await import('events');
  class FakeWorker extends EE {
    terminated = false;
    constructor() { super(); h.workers.push(this); }
    terminate() { this.terminated = true; setImmediate(() => this.emit('exit', 1)); return Promise.resolve(1); }
  }
  return { Worker: FakeWorker, default: { Worker: FakeWorker } };
});

import { runBulkUpload, cancelBulkUpload, ALIGNMENT_CHECK_TIMEOUT_MS } from '../src/main/sync/bulk-uploader';

const run = () => runBulkUpload(7, false, false, false, false, null, () => {}, 'test');
const flush = () => new Promise<void>(r => setImmediate(r));

describe('runBulkUpload — délai du contrôle d\'alignement et annulation (audit fbec916 P1-2)', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'http://fake.local';
    process.env.VITE_SUPABASE_ANON_KEY = 'fake';
    delete process.env.GEST_IN_SITU_E2E_DISABLE_SYNC;
    h.workers.length = 0;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('réseau bloqué : refus après le délai maximal, message réseau, aucun worker', async () => {
    vi.useFakeTimers();
    h.check = () => new Promise(() => {});
    const p = run();
    await vi.advanceTimersByTimeAsync(ALIGNMENT_CHECK_TIMEOUT_MS);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.message).toContain('délai dépassé');
    expect(res.message).toContain('Vérifiez la connexion');
    expect(h.workers).toHaveLength(0);
  });

  it('annulation pendant le contrôle : retenue, le worker ne démarre pas', async () => {
    let release!: (v: { ok: true }) => void;
    h.check = () => new Promise(r => { release = r; });
    const p = run();
    await flush();
    cancelBulkUpload();
    release({ ok: true });
    const res = await p;
    expect(res.cancelled).toBe(true);
    expect(h.workers).toHaveLength(0);
  });

  it('annulation pendant l\'envoi : la promesse se conclut (annulé)', async () => {
    h.check = async () => ({ ok: true });
    const p = run();
    await flush();
    expect(h.workers).toHaveLength(1);
    cancelBulkUpload();
    const res = await p;
    expect(h.workers[0].terminated).toBe(true);
    expect(res.cancelled).toBe(true);
  });

  it('annulation sans envoi en cours : aucun effet sur l\'envoi suivant', async () => {
    cancelBulkUpload();
    h.check = async () => ({ ok: true });
    const p = run();
    await flush();
    (h.workers[0] as EventEmitter).emit('message', { type: 'done', uploadedCount: 3, message: 'ok' });
    const res = await p;
    expect(res).toMatchObject({ success: true, uploadedCount: 3 });
  });

  it('poste non aligné (hors réseau) : refus avec consigne de redémarrage', async () => {
    h.check = async () => ({ ok: false, reason: '[NON ALIGNÉ] site local 7 ≠ cloud.' });
    const res = await run();
    expect(res.success).toBe(false);
    expect(res.message).toContain('Redémarrez');
    expect(h.workers).toHaveLength(0);
  });
});
