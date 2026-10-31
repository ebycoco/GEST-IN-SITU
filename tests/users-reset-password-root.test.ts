import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Règles de réinitialisation de mot de passe (2026-10-31) — users.queries.ts + users:getAll.
 *  1. ROOT (id 999999, rôle actif SUPER ADMIN, aucune ligne t_users) -> SUPER ADMIN et ADMINISTRATEUR_SITE (tout site).
 *  2. SUPER ADMIN normal -> ADMINISTRATEUR_SITE (tout site) ; SUPER ADMIN -> SUPER ADMIN refusé.
 *  3. ADMINISTRATEUR_SITE -> agents de son site uniquement, jamais un SUPER ADMIN.
 * Base SQLite TEMPORAIRE (initDatabase) ; modules réseau/sync mockés : aucun accès Supabase ni base réelle.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-reset-root-'));

const enqueueOutboxMock = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: (...args: unknown[]) => enqueueOutboxMock(...args),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true)
}));
vi.mock('../src/main/sync/network-monitor', () => ({ networkMonitor: { getState: () => 'OFFLINE' } }));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogin: vi.fn() }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

describe('Réinitialisation du mot de passe : ROOT / SUPER ADMIN / ADMINISTRATEUR_SITE', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 821;
  const SITE_B = 822;
  const ROOT = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' } as const;

  type Row = { id_user: number; login: string; password_hash: string; role: string; site_id: number | null; sync_id: string };
  const row = (login: string) => db.prepare('SELECT * FROM t_users WHERE login = ?').get(login) as Row;

  function mk(login: string, role: string, site: number | null, roles: string[] = [role]): Row {
    db.prepare(`INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, sync_id, is_dirty)
                VALUES (?, 'HASH_' || ?, ?, 'Nom', 'Prenom', 1, ?, ?, 0)`).run(login, login, role, site, `sync-${login}`);
    const r = row(login);
    for (const x of roles) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(r.id_user, x);
    return r;
  }
  const caller = (u: Row) => ({ id_user: u.id_user, role: u.role, site_id: u.site_id ?? undefined });

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    uq = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-821')`).run(SITE_A);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_B', 'SITE_B', 1, 1, 'site-sync-822')`).run(SITE_B);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    enqueueOutboxMock.mockClear();
    db.prepare('DELETE FROM t_logs').run();
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  describe('resetAgentPassword', () => {
    it('ROOT -> SUPER ADMIN : OK, hash changé, mot de passe temporaire de 8 caractères', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const res = uq.resetAgentPassword(sa.id_user, ROOT);
      expect(res.success).toBe(true);
      expect(res.temporaryPassword).toHaveLength(8);
      expect(row('sa').password_hash).not.toBe(sa.password_hash);
    });

    it('ROOT -> ADMINISTRATEUR_SITE d\'un site quelconque : OK', () => {
      const a = mk('admA', 'ADMINISTRATEUR_SITE', SITE_A);
      const b = mk('admB', 'ADMINISTRATEUR_SITE', SITE_B);
      expect(uq.resetAgentPassword(a.id_user, ROOT).success).toBe(true);
      expect(uq.resetAgentPassword(b.id_user, ROOT).success).toBe(true);
    });

    it('ROOT -> cible détenant SUPER ADMIN seulement via t_user_roles : OK', () => {
      const t = mk('multi', 'ADMINISTRATEUR_SITE', SITE_A, ['ADMINISTRATEUR_SITE', 'SUPER ADMIN']);
      expect(uq.resetAgentPassword(t.id_user, ROOT).success).toBe(true);
    });

    it('SUPER ADMIN normal -> ADMINISTRATEUR_SITE (autre site) : OK', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const b = mk('admB', 'ADMINISTRATEUR_SITE', SITE_B);
      expect(uq.resetAgentPassword(b.id_user, caller(sa)).success).toBe(true);
      expect(row('admB').password_hash).not.toBe(b.password_hash);
    });

    it('SUPER ADMIN normal -> SUPER ADMIN : refusé, hash inchangé, rien en outbox', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const sa2 = mk('sa2', 'SUPER ADMIN', null);
      expect(() => uq.resetAgentPassword(sa2.id_user, caller(sa))).toThrow('seul le compte ROOT');
      expect(row('sa2')).toEqual(sa2);
      expect(enqueueOutboxMock).not.toHaveBeenCalled();
    });

    it('SUPER ADMIN normal -> lui-même : refusé', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      expect(() => uq.resetAgentPassword(sa.id_user, caller(sa))).toThrow('seul le compte ROOT');
    });

    it('ADMINISTRATEUR_SITE -> SUPER ADMIN : refusé (message historique), hash inchangé', () => {
      const sa = mk('sa', 'SUPER ADMIN', SITE_A);
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(() => uq.resetAgentPassword(sa.id_user, caller(adm))).toThrow('Accès non autorisé aux données de ce site');
      expect(row('sa')).toEqual(sa);
    });

    it('ADMINISTRATEUR_SITE -> admin d\'un autre site : refusé', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const other = mk('other', 'ADMINISTRATEUR_SITE', SITE_B);
      expect(() => uq.resetAgentPassword(other.id_user, caller(adm))).toThrow("n'appartient pas à votre site");
      expect(row('other')).toEqual(other);
    });

    it('ADMINISTRATEUR_SITE -> agent de son site : OK', () => {
      const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
      const ag = mk('ag', 'OPERATEUR_SAISIE', SITE_A);
      expect(uq.resetAgentPassword(ag.id_user, caller(adm)).success).toBe(true);
    });

    it('faux ROOT : id 999999 avec un rôle ADMINISTRATEUR_SITE ne contourne rien', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      expect(() => uq.resetAgentPassword(sa.id_user, { id_user: 999999, role: 'ADMINISTRATEUR_SITE', site_id: SITE_A })).toThrow();
      expect(row('sa')).toEqual(sa);
    });

    it('le mot de passe temporaire n\'est jamais journalisé ni mis en outbox en clair', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      const { temporaryPassword } = uq.resetAgentPassword(sa.id_user, ROOT);
      const logs = JSON.stringify(db.prepare('SELECT * FROM t_logs').all());
      const audits = JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
      const outbox = JSON.stringify(enqueueOutboxMock.mock.calls);
      for (const blob of [logs, audits, outbox]) expect(blob).not.toContain(temporaryPassword);
      expect(logs).toContain('RESET_PASSWORD');
      expect(audits).toContain('RÉINITIALISATION MOT DE PASSE');
    });

    it('outbox : UPDATE t_users avec sync_id, login, role et nouveau hash de la cible synchronisée', () => {
      const b = mk('admB', 'ADMINISTRATEUR_SITE', SITE_B);
      uq.resetAgentPassword(b.id_user, ROOT);
      expect(enqueueOutboxMock).toHaveBeenCalledTimes(1);
      const [syncId, table, op, payload] = enqueueOutboxMock.mock.calls[0];
      expect(syncId).toBe('sync-admB');
      expect(table).toBe('t_users');
      expect(op).toBe('UPDATE');
      expect(payload).toMatchObject({ sync_id: 'sync-admB', login: 'admB', role: 'ADMINISTRATEUR_SITE', password_hash: row('admB').password_hash });
    });
  });

  describe('getUsers (liste)', () => {
    it('par défaut (SUPER ADMIN normal, ADMIN_SITE...) : aucun SUPER ADMIN dans la liste', () => {
      mk('sa', 'SUPER ADMIN', null);
      mk('admA', 'ADMINISTRATEUR_SITE', SITE_A);
      expect(uq.getUsers().map(u => u.login)).toEqual(['admA']);
      expect(uq.getUsers(undefined, undefined, {}).map(u => u.login)).toEqual(['admA']);
      expect(uq.getUsers(undefined, undefined, { includeSuperAdmins: false }).map(u => u.login)).toEqual(['admA']);
    });

    it('SUPER ADMIN normal voit les ADMINISTRATEUR_SITE de chaque site (filtre site, ou aucun filtre)', () => {
      mk('admA', 'ADMINISTRATEUR_SITE', SITE_A);
      mk('admB', 'ADMINISTRATEUR_SITE', SITE_B);
      expect(uq.getUsers().map(u => u.login).sort()).toEqual(['admA', 'admB']);
      expect(uq.getUsers(SITE_B).map(u => u.login)).toEqual(['admB']);
    });

    it('ROOT (includeSuperAdmins) : voit les SUPER ADMIN, même sans site, avec ou sans filtre de site', () => {
      mk('sa', 'SUPER ADMIN', null);
      mk('saA', 'SUPER ADMIN', SITE_A);
      mk('admB', 'ADMINISTRATEUR_SITE', SITE_B);
      expect(uq.getUsers(undefined, undefined, { includeSuperAdmins: true }).map(u => u.login).sort()).toEqual(['admB', 'sa', 'saA']);
      expect(uq.getUsers(SITE_B, undefined, { includeSuperAdmins: true }).map(u => u.login).sort()).toEqual(['admB', 'sa', 'saA']);
      expect(uq.getUsers(SITE_A, undefined, { includeSuperAdmins: true }).map(u => u.login).sort()).toEqual(['sa', 'saA']);
    });

    it('ROOT : les comptes supprimés (-1) restent exclus et password_hash n\'est jamais renvoyé', () => {
      const sa = mk('sa', 'SUPER ADMIN', null);
      db.prepare('UPDATE t_users SET statut_actif = -1 WHERE id_user = ?').run(sa.id_user);
      const list = uq.getUsers(undefined, undefined, { includeSuperAdmins: true });
      expect(list).toEqual([]);
      mk('sa2', 'SUPER ADMIN', null);
      expect(uq.getUsers(undefined, undefined, { includeSuperAdmins: true })[0]).not.toHaveProperty('password_hash');
    });
  });

  describe('handler users:getAll (lecture du source)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'handlers.ts'), 'utf8');
    const start = src.indexOf("ipcMain.handle('users:getAll'");
    const block = src.slice(start, src.indexOf("ipcMain.handle('users:getProfile'"));

    it('le canal n\'accepte que (siteId, centreId) : aucun paramètre ne peut activer la liste des SUPER ADMIN', () => {
      expect(block).toMatch(/\(_, siteId\?: number, centreId\?: number\)/);
    });
    it('includeSuperAdmins est déduit de la session serveur (id 999999 + rôle SUPER ADMIN), jamais du renderer', () => {
      expect(block).toMatch(/isRootSession = secureUser\.id_user === FAILSAFE_ROOT_ID && secureUser\.role === 'SUPER ADMIN'/);
      expect(block).toMatch(/includeSuperAdmins: isRootSession/);
    });
  });
});
