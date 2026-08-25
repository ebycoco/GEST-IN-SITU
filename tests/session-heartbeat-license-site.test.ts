import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test ciblé — Correctif "licence par site" (session déjà ouverte).
 *
 * Vérifie que refreshSecureCurrentUser() (src/main/auth/session-heartbeat.ts) détecte bien,
 * pour une session déjà ouverte (pas seulement au login via authenticateUser()), un site
 * suspendu (t_sites.is_active = 0) ou une licence expirée (t_sites.expiry_date dépassé,
 * is_permanent != 1) — même logique que authenticateUser() (users.queries.ts:106-116),
 * répliquée en lecture seule. Utilise la vraie fonction (pas de réimplémentation), contre
 * une base SQLite réelle migrée via initDatabase(), même pattern que
 * tests/hierarchy-delete-site.test.ts.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-license-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
    isPackaged: false
  },
  net: {
    online: true,
    request: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}));

describe('refreshSecureCurrentUser() — détection site suspendu / licence expirée sur session déjà ouverte', () => {
  let connection: typeof import('../src/main/database/connection');
  let heartbeat: typeof import('../src/main/auth/session-heartbeat');
  let db: import('better-sqlite3').Database;

  const SITE_OK_ID = 910;
  const SITE_SUSPENDED_ID = 911;
  const SITE_EXPIRED_ID = 912;
  const SITE_PERMANENT_ID = 913;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    heartbeat = await import('../src/main/auth/session-heartbeat');

    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_OK', 'SITE_OK', 1, 0, 'site-sync-910')`).run(SITE_OK_ID);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_SUSPENDED', 'SITE_SUSPENDED', 0, 0, 'site-sync-911')`).run(SITE_SUSPENDED_ID);
    // Licence expirée : is_permanent = 0, expiry_date dans le passé.
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, expiry_date, sync_id) VALUES (?, 'SITE_EXPIRED', 'SITE_EXPIRED', 1, 0, '2020-01-01', 'site-sync-912')`).run(SITE_EXPIRED_ID);
    // Site permanent avec une date passée : is_permanent doit primer (jamais expiré).
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, expiry_date, sync_id) VALUES (?, 'SITE_PERMANENT', 'SITE_PERMANENT', 1, 1, '2020-01-01', 'site-sync-913')`).run(SITE_PERMANENT_ID);

    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES ('agent.ok', 'hash', 'OPERATEUR_SAISIE', ?, 1, 'agent-ok')`).run(SITE_OK_ID);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login = ?), ?)').run('agent.ok', 'OPERATEUR_SAISIE');

    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES ('agent.suspended', 'hash', 'OPERATEUR_SAISIE', ?, 1, 'agent-suspended')`).run(SITE_SUSPENDED_ID);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login = ?), ?)').run('agent.suspended', 'OPERATEUR_SAISIE');

    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES ('agent.expired', 'hash', 'OPERATEUR_SAISIE', ?, 1, 'agent-expired')`).run(SITE_EXPIRED_ID);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login = ?), ?)').run('agent.expired', 'OPERATEUR_SAISIE');

    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES ('agent.permanent', 'hash', 'OPERATEUR_SAISIE', ?, 1, 'agent-permanent')`).run(SITE_PERMANENT_ID);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login = ?), ?)').run('agent.permanent', 'OPERATEUR_SAISIE');

    db.prepare(`INSERT INTO t_users (login, password_hash, role, site_id, statut_actif, sync_id) VALUES ('super.admin', 'hash', 'SUPER ADMIN', ?, 1, 'super-admin-910')`).run(SITE_SUSPENDED_ID);
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES ((SELECT id_user FROM t_users WHERE login = ?), ?)').run('super.admin', 'SUPER ADMIN');
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await heartbeat.stopSessionHeartbeat();
  });

  it('détecte site_is_active=0 dès le premier refresh (site déjà suspendu au moment du login simulé)', () => {
    const idUser = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get('agent.suspended') as any).id_user;
    heartbeat.startSessionHeartbeat({ login: 'agent.suspended', role: 'OPERATEUR_SAISIE', site_id: SITE_SUSPENDED_ID, id_user: idUser }, 'tok-2');
    const result = heartbeat.refreshSecureCurrentUser();
    expect(result.siteSuspended).toBe(true);
    expect(result.licenseExpired).toBe(false);
    expect(result.revoked).toBe(false);
    expect(result.disabled).toBe(false);
    // Invariant : site_id/role ne sont jamais mutés par cette branche.
    const current = heartbeat.getSecureCurrentUser();
    expect(current.site_id).toBe(SITE_SUSPENDED_ID);
    expect(current.role).toBe('OPERATEUR_SAISIE');
  });

  it('détecte une licence expirée (expiry_date dépassé, is_permanent=0)', () => {
    const idUser = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get('agent.expired') as any).id_user;
    heartbeat.startSessionHeartbeat({ login: 'agent.expired', role: 'OPERATEUR_SAISIE', site_id: SITE_EXPIRED_ID, id_user: idUser }, 'tok-3');
    const result = heartbeat.refreshSecureCurrentUser();
    expect(result.licenseExpired).toBe(true);
    expect(result.siteSuspended).toBe(false);
  });

  it('ne signale rien pour un site permanent (is_permanent=1) même avec une expiry_date passée', () => {
    const idUser = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get('agent.permanent') as any).id_user;
    heartbeat.startSessionHeartbeat({ login: 'agent.permanent', role: 'OPERATEUR_SAISIE', site_id: SITE_PERMANENT_ID, id_user: idUser }, 'tok-4');
    const result = heartbeat.refreshSecureCurrentUser();
    expect(result.licenseExpired).toBe(false);
    expect(result.siteSuspended).toBe(false);
  });

  it('ne signale rien pour un site actif/licence valide', () => {
    const idUser = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get('agent.ok') as any).id_user;
    heartbeat.startSessionHeartbeat({ login: 'agent.ok', role: 'OPERATEUR_SAISIE', site_id: SITE_OK_ID, id_user: idUser }, 'tok-5');
    const result = heartbeat.refreshSecureCurrentUser();
    expect(result.licenseExpired).toBe(false);
    expect(result.siteSuspended).toBe(false);
  });

  it('SUPER ADMIN est exempté de la vérification, même rattaché à un site suspendu', () => {
    const idUser = (db.prepare('SELECT id_user FROM t_users WHERE login = ?').get('super.admin') as any).id_user;
    heartbeat.startSessionHeartbeat({ login: 'super.admin', role: 'SUPER ADMIN', site_id: SITE_SUSPENDED_ID, id_user: idUser }, 'tok-6');
    const result = heartbeat.refreshSecureCurrentUser();
    expect(result.siteSuspended).toBe(false);
    expect(result.licenseExpired).toBe(false);
  });
});
