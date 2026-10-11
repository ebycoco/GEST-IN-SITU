import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * L2-0b (P1-3) : la session doit suivre le compte par id_user, pas par login, afin de survivre
 * à un renommage de login côté cloud (même sync_id). Fail-closed conservé pour désactivé /
 * supprimé / rôle révoqué. Base SQLite jetable réelle (initDatabase), vraies fonctions.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-renamed-login-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('refreshSecureCurrentUser() — login renommé (L2-0b)', () => {
  let connection: typeof import('../src/main/database/connection');
  let heartbeat: typeof import('../src/main/auth/session-heartbeat');
  let db: import('better-sqlite3').Database;
  const SITE = 920;
  let n = 0;

  function mkUser(login: string, role = 'OPERATEUR_SAISIE', extraRoles: string[] = []): { id: number; syncId: string } {
    n++;
    const syncId = `rl-sync-${n}`;
    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES (?, 'h', ?, ?, 1, ?)`).run(login, role, SITE, syncId);
    const id = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get(login) as any).id_user as number;
    for (const r of [role, ...extraRoles]) db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(id, r);
    return { id, syncId };
  }
  const start = (login: string, id: number, role = 'OPERATEUR_SAISIE') =>
    heartbeat.startSessionHeartbeat({ login, role, site_id: SITE, id_user: id }, `tok-${login}`);

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    heartbeat = await import('../src/main/auth/session-heartbeat');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'S920', 'S920', 1, 1, 'site-sync-920')`).run(SITE);
  });

  afterAll(async () => {
    await heartbeat.stopSessionHeartbeat();
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await heartbeat.stopSessionHeartbeat();
  });

  it('login renommé : session conservée, login de session mis à jour, disabled=false', () => {
    const u = mkUser('rn.old');
    start('rn.old', u.id);
    db.prepare('UPDATE t_users SET login = ? WHERE id_user = ?').run('rn.new', u.id);
    const r = heartbeat.refreshSecureCurrentUser();
    expect(r.disabled).toBe(false);
    expect(r.revoked).toBe(false);
    expect(heartbeat.getSecureCurrentUser().login).toBe('rn.new');
    expect(heartbeat.getCurrentUserLogin()).toBe('rn.new');
    expect(heartbeat.getSecureCurrentUser().site_id).toBe(SITE);
  });

  it('resolveCurrentSessionLogin() renvoie le login courant après renommage', () => {
    const u = mkUser('rs.old');
    start('rs.old', u.id);
    db.prepare('UPDATE t_users SET login = ? WHERE id_user = ?').run('rs.new', u.id);
    expect(heartbeat.resolveCurrentSessionLogin()).toBe('rs.new');
    expect(heartbeat.getSecureCurrentUser().login).toBe('rs.new');
  });

  it('statut_actif=0 (après renommage) -> disabled', () => {
    const u = mkUser('dis.old');
    start('dis.old', u.id);
    db.prepare('UPDATE t_users SET login = ?, statut_actif = 0 WHERE id_user = ?').run('dis.new', u.id);
    expect(heartbeat.refreshSecureCurrentUser().disabled).toBe(true);
  });

  it('ligne supprimée par id -> disabled', () => {
    const u = mkUser('del.old');
    start('del.old', u.id);
    db.prepare('DELETE FROM t_user_roles WHERE id_user = ?').run(u.id);
    db.prepare('DELETE FROM t_users WHERE id_user = ?').run(u.id);
    expect(heartbeat.refreshSecureCurrentUser().disabled).toBe(true);
  });

  it('rôle actif retiré -> revoked', () => {
    const u = mkUser('rev.old', 'OPERATEUR_SAISIE', ['ADMIN_CENTRE']);
    start('rev.old', u.id);
    heartbeat.setActiveRole('ADMIN_CENTRE');
    db.prepare('UPDATE t_users SET login = ? WHERE id_user = ?').run('rev.new', u.id);
    db.prepare('DELETE FROM t_user_roles WHERE id_user = ? AND role = ?').run(u.id, 'ADMIN_CENTRE');
    const r = heartbeat.refreshSecureCurrentUser();
    expect(r.revoked).toBe(true);
    expect(r.disabled).toBe(false);
  });

  it('multi-rôles : rôle actif non primaire conservé après renommage', () => {
    const u = mkUser('mr.old', 'OPERATEUR_SAISIE', ['ADMIN_CENTRE']);
    start('mr.old', u.id);
    heartbeat.setActiveRole('ADMIN_CENTRE');
    db.prepare('UPDATE t_users SET login = ? WHERE id_user = ?').run('mr.new', u.id);
    const r = heartbeat.refreshSecureCurrentUser();
    expect(r.disabled).toBe(false);
    expect(r.revoked).toBe(false);
    expect(heartbeat.getSecureCurrentUser().role).toBe('ADMIN_CENTRE');
    expect(heartbeat.getSecureCurrentUser().login).toBe('mr.new');
  });

  it('ancien login réutilisé par un AUTRE compte : la session suit son id, pas le login', () => {
    const u = mkUser('atk.old');
    start('atk.old', u.id);
    db.prepare('UPDATE t_users SET login = ? WHERE id_user = ?').run('atk.new', u.id);
    // Un autre compte (désactivé) prend l'ancien login : ne doit pas être confondu.
    const other = mkUser('atk.old');
    db.prepare('UPDATE t_users SET statut_actif = 0 WHERE id_user = ?').run(other.id);
    const r = heartbeat.refreshSecureCurrentUser();
    expect(r.disabled).toBe(false);
    expect(heartbeat.getSecureCurrentUser().login).toBe('atk.new');
    expect(heartbeat.getSecureCurrentUser().id_user).toBe(u.id);
  });

  it('sync_id de session différent de la ligne (id réutilisé) -> disabled', () => {
    const u = mkUser('sid.old');
    heartbeat.startSessionHeartbeat({ login: 'sid.old', role: 'OPERATEUR_SAISIE', site_id: SITE, id_user: u.id, sync_id: 'autre-sync' }, 'tok-sid');
    expect(heartbeat.refreshSecureCurrentUser().disabled).toBe(true);
  });

  it('repli login quand la session n\'a pas d\'id_user', () => {
    mkUser('fb.user');
    heartbeat.startSessionHeartbeat({ login: 'fb.user', role: 'OPERATEUR_SAISIE', site_id: SITE }, 'tok-fb');
    expect(heartbeat.refreshSecureCurrentUser().disabled).toBe(false);
  });
});
