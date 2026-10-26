import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 8) — même correctif que fix-qualite-corriger-format-source.test.ts,
 * exercé cette fois via le VRAI handler `qualite:corrigerFormat` enregistré par
 * registerIpcHandlers (normalisation de date, contrôle de rôle, audit), base SQLite jetable.
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-cf-handler-'));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBoxSync: vi.fn() },
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }
}));

vi.mock('../src/main/auth/session-heartbeat', () => ({
  startSessionHeartbeat: vi.fn(),
  stopSessionHeartbeat: vi.fn(),
  getCurrentUserLogin: vi.fn(() => 'cf.admin'),
  getSecureCurrentUser: vi.fn(() => null),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn()
}));

describe('handler qualite:corrigerFormat — source obligatoire (audit 2026-10-26 point 8)', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let corriger: (e: unknown, p: Record<string, unknown>) => Promise<any>;
  const SITE_ID = 942;
  const USER_ID = 9421;
  let seq = 0;

  const insertCollision = () => {
    seq += 1;
    const id = Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty)
      VALUES (?, 'HCARTE', ?, '1985-13-45', 'ABIDJAN', '0700000000', 'R-1', 'EN STOCK', ?, 0)
    `).run(SITE_ID, `P${seq}`, `sync-cfh-${seq}`).lastInsertRowid);
    db.prepare(`
      INSERT INTO t_import_anomalies (id, site_id, carte_id, type_anomalie, noms, prenoms, date_de_naissance, num_secu, contact)
      VALUES (?, ?, '1234567890123', 'DATE_INVALIDE', 'HANOMALIE', ?, '99/99/1999', '1234567890123', '0500000000')
    `).run(id, SITE_ID, `PA${seq}`);
    return id;
  };
  const carte = (id: number) => db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
  const anomalie = (id: number) => db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;
  /** logAudit() écrit en différé (setImmediate) : on laisse passer un tour de boucle. */
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const nbAudits = () => (db.prepare(`SELECT COUNT(*) AS c FROM t_audit_log WHERE action = 'QUALITE_CORRECTION'`).get() as { c: number }).c;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    const handlers = await import('../src/main/ipc/handlers');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CFH', 'SITE_CFH', 1, 'site-cfh')`).run(SITE_ID);
    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id, centre_id)
      VALUES (?, 'cf.admin', 'x', 'SUPER ADMIN', 'Test', 1, NULL, NULL)
    `).run(USER_ID);

    const { ipcMain } = await import('electron');
    handlers.registerIpcHandlers({ webContents: { send: vi.fn() }, isDestroyed: () => false } as any);
    corriger = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'qualite:corrigerFormat')![1] as any;

    const heartbeat = await import('../src/main/auth/session-heartbeat');
    vi.mocked(heartbeat.getSecureCurrentUser).mockReturnValue(
      { id_user: USER_ID, login: 'cf.admin', role: 'SUPER ADMIN', site_id: null, centre_id: null } as any
    );
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('source t_cartes + date JJ/MM/AAAA : carte n°N corrigée en ISO, anomalie n°N intacte, audit écrit', async () => {
    const id = insertCollision();
    await flush();
    const audits = nbAudits();
    const res = await corriger({}, { id_carte: id, source: 't_cartes', champ_corrige: 'date_de_naissance', valeur_avant: '1985-13-45', valeur_apres: '15/03/1985' });
    expect(res).toMatchObject({ success: true, changes: 1, id_carte: id, transferee: false });
    expect(carte(id).date_de_naissance).toBe('1985-03-15');
    expect(anomalie(id).date_de_naissance).toBe('99/99/1999');
    await flush();
    expect(nbAudits()).toBe(audits + 1);
  });

  it('source t_import_anomalies : transfert (carte_id = n° sécu ignoré), carte n°N intacte', async () => {
    const id = insertCollision();
    const avant = carte(id);
    const res = await corriger({}, { id_carte: id, source: 't_import_anomalies', champ_corrige: 'date_de_naissance', valeur_avant: '99/99/1999', valeur_apres: '01/02/1999' });
    expect(res.success).toBe(true);
    expect(res.transferee).toBe(true);
    expect(carte(res.id_carte).date_de_naissance).toBe('1999-02-01');
    expect(carte(res.id_carte).noms).toBe('HANOMALIE');
    expect(anomalie(id)).toBeUndefined();
    expect(carte(id)).toEqual(avant);
  });

  it('source absente → erreur claire, aucune écriture ni audit', async () => {
    const id = insertCollision();
    await flush();
    const audits = nbAudits();
    await expect(corriger({}, { id_carte: id, champ_corrige: 'contact', valeur_avant: '', valeur_apres: '0102030405' }))
      .rejects.toThrow(/source/i);
    expect(carte(id).contact).toBe('0700000000');
    expect(anomalie(id)).toBeTruthy();
    await flush();
    expect(nbAudits()).toBe(audits);
  });

  it('fiche introuvable → success:false, aucun audit', async () => {
    await flush();
    const audits = nbAudits();
    const res = await corriger({}, { id_carte: 99_999_003, source: 't_cartes', champ_corrige: 'contact', valeur_avant: '', valeur_apres: '0102030405' });
    expect(res).toMatchObject({ success: false, changes: 0 });
    await flush();
    expect(nbAudits()).toBe(audits);
  });
});
