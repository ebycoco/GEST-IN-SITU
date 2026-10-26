import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Audit 2026-10-26 (point 9) — une date saisie JJ/MM/AAAA via qualite:corrigerFormat ou
 * cartes:updateDate doit être normalisée en AAAA-MM-JJ avant écriture (sinon elle était
 * stockée brute). On exerce les VRAIS handlers enregistrés par registerIpcHandlers, sur une
 * base SQLite jetable (aucun réseau).
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-datenorm-'));

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
  getCurrentUserLogin: vi.fn(() => 'test.user'),
  getSecureCurrentUser: vi.fn(() => null),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn()
}));

describe('dates JJ/MM/AAAA — normalisation avant écriture', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let corriger: (e: any, p: any) => Promise<any>;
  let updateDate: (e: any, id: number, d: string) => Promise<any>;
  const SITE_ID = 940;
  const USER_ID = 9401;

  const dateOf = (id: number) => (db.prepare('SELECT date_de_naissance AS d FROM t_cartes WHERE id_carte = ?').get(id) as any).d;
  function insertCarte(suffix: string, ddn: string | null): number {
    return Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, rangement, statut, sync_id, is_dirty)
      VALUES (?, 'TEST', ?, ?, 'R-1', 'EN STOCK', ?, 0)
    `).run(SITE_ID, `DN_${suffix}`, ddn, `sync-dn-${suffix}`).lastInsertRowid);
  }

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    const handlers = await import('../src/main/ipc/handlers');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DN', 'SITE_DN', 1, 'site-dn')`).run(SITE_ID);
    db.prepare(`
      INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id, centre_id)
      VALUES (?, 'dn.admin', 'x', 'SUPER ADMIN', 'Test', 1, NULL, NULL)
    `).run(USER_ID);

    const { ipcMain } = await import('electron');
    handlers.registerIpcHandlers({ webContents: { send: vi.fn() }, isDestroyed: () => false } as any);
    const find = (ch: string) => vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === ch)![1] as any;
    corriger = find('qualite:corrigerFormat');
    updateDate = find('cartes:updateDate');

    const heartbeat = await import('../src/main/auth/session-heartbeat');
    vi.mocked(heartbeat.getSecureCurrentUser).mockReturnValue(
      { id_user: USER_ID, login: 'dn.admin', role: 'SUPER ADMIN', site_id: null, centre_id: null } as any
    );
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('qualite:corrigerFormat accepte 15/03/1985 et stocke 1985-03-15', async () => {
    const id = insertCarte('A', '1985-13-45');
    const res = await corriger({}, { id_carte: id, source: 't_cartes', champ_corrige: 'date_de_naissance', valeur_avant: '1985-13-45', valeur_apres: '15/03/1985' });
    expect(res.success).toBe(true);
    expect(dateOf(id)).toBe('1985-03-15');
  });

  it('qualite:corrigerFormat refuse 31/02/1990 sans écrire', async () => {
    const id = insertCarte('B', '1990-99-99');
    await expect(
      corriger({}, { id_carte: id, source: 't_cartes', champ_corrige: 'date_de_naissance', valeur_avant: '1990-99-99', valeur_apres: '31/02/1990' })
    ).rejects.toThrow(/invalide/i);
    expect(dateOf(id)).toBe('1990-99-99');
  });

  it('cartes:updateDate accepte 15/03/1985 et stocke 1985-03-15', async () => {
    const id = insertCarte('C', '1985-13-45');
    await updateDate({}, id, '15/03/1985');
    expect(dateOf(id)).toBe('1985-03-15');
  });

  it('cartes:updateDate refuse 31/02/1990 sans écrire', async () => {
    const id = insertCarte('D', '1990-99-99');
    await expect(updateDate({}, id, '31/02/1990')).rejects.toThrow(/invalide/i);
    expect(dateOf(id)).toBe('1990-99-99');
  });
});
