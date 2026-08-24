import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test ciblé — Correctif P0 (audit terrain agent-13) sur deleteSite()
 * (src/main/database/queries/hierarchy.queries.ts).
 *
 * Bug : la "PURGE COMPLÈTE DU SITE" supprimait bien localement t_sites/t_centres/
 * t_users du site, mais ne nettoyait l'Outbox (t_outbox) que pour le site lui-même
 * et les SUPER ADMIN neutralisés — jamais pour les entités cascadées (centres,
 * agents, t_user_roles), qui restaient PENDING avec leurs opérations d'origine
 * (INSERT/UPDATE) et auraient été rejouées vers Supabase à la reconnexion réseau.
 *
 * Ce test exerce la vraie fonction deleteSite() (pas une réimplémentation) contre
 * une base SQLite réelle (migrations de production via runMigrations), avec le
 * module 'electron' mocké au strict nécessaire (app.getPath / net / BrowserWindow)
 * pour permettre l'initialisation réelle de connection.ts (initDatabase), seul
 * moyen de garantir que outbox.service.ts et hierarchy.queries.ts partagent bien
 * le même singleton SQLite (cf. getDatabase()) — condition nécessaire à la
 * garantie d'atomicité vérifiée ci-dessous.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-'));

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

describe('deleteSite() — nettoyage cascade de l\'Outbox (bug P0)', () => {
  let connection: typeof import('../src/main/database/connection');
  let hierarchyQueries: typeof import('../src/main/database/queries/hierarchy.queries');
  let db: import('better-sqlite3').Database;

  const SITE_ID = 900;
  const SITE_SYNC_ID = 'site-sync-900';

  const CENTRE_SYNCED_SYNC_ID = 'centre-sync-synced';
  const CENTRE_UNSYNCED_SYNC_ID = 'centre-sync-unsynced';

  const AGENT_SYNCED_SYNC_ID = 'agent-sync-synced';
  const AGENT_UNSYNCED_SYNC_ID = 'agent-sync-unsynced';

  const SUPERADMIN_SYNC_ID = 'superadmin-sync-900';

  let centreSyncedId: number;
  let centreUnsyncedId: number;
  let agentSyncedId: number;
  let agentUnsyncedId: number;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    hierarchyQueries = await import('../src/main/database/queries/hierarchy.queries');

    db = await connection.initDatabase();

    // ── Site ────────────────────────────────────────────────────────────────
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_P0_TEST', 'SITE_P0_TEST', 1, ?)`)
      .run(SITE_ID, SITE_SYNC_ID);

    // ── Centres : un déjà synchronisé, un jamais synchronisé (INSERT encore PENDING) ──
    centreSyncedId = db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'CENTRE_SYNCED', ?)`)
      .run(SITE_ID, CENTRE_SYNCED_SYNC_ID).lastInsertRowid as number;
    centreUnsyncedId = db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'CENTRE_UNSYNCED', ?)`)
      .run(SITE_ID, CENTRE_UNSYNCED_SYNC_ID).lastInsertRowid as number;

    // ── Agents (hors SUPER ADMIN) : un déjà synchronisé (multi-rôles), un jamais synchronisé ──
    agentSyncedId = db.prepare(`
      INSERT INTO t_users (login, password_hash, role, site_id, centre_id, sync_id)
      VALUES ('agent.synced', 'hash', 'OPERATEUR_SAISIE', ?, ?, ?)
    `).run(SITE_ID, centreSyncedId, AGENT_SYNCED_SYNC_ID).lastInsertRowid as number;
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(agentSyncedId, 'OPERATEUR_SAISIE');
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(agentSyncedId, 'ADMIN_CENTRE');

    agentUnsyncedId = db.prepare(`
      INSERT INTO t_users (login, password_hash, role, site_id, centre_id, sync_id)
      VALUES ('agent.unsynced', 'hash', 'OPERATEUR_VERIFICATION', ?, ?, ?)
    `).run(SITE_ID, centreSyncedId, AGENT_UNSYNCED_SYNC_ID).lastInsertRowid as number;
    db.prepare('INSERT INTO t_user_roles (id_user, role) VALUES (?, ?)').run(agentUnsyncedId, 'OPERATEUR_VERIFICATION');

    // ── SUPER ADMIN rattaché au site (chemin déjà existant, doit rester intact) ──
    db.prepare(`
      INSERT INTO t_users (login, password_hash, role, site_id, sync_id)
      VALUES ('super.admin', 'hash', 'SUPER ADMIN', ?, ?)
    `).run(SITE_ID, SUPERADMIN_SYNC_ID);

    // ── État Outbox PRÉALABLE à l'appel de deleteSite() ──────────────────────
    // Entités "déjà synchronisées" : aucune entrée PENDING (comme si l'INSERT
    // initial avait déjà été confirmé par Supabase lors d'un cycle précédent).
    // Entités "jamais synchronisées" : un INSERT encore PENDING, simulant une
    // création faite hors-ligne et jamais envoyée.
    const insertOutbox = db.prepare(`
      INSERT INTO t_outbox (id, table_name, operation, payload, status)
      VALUES (?, ?, 'INSERT', '{}', 'PENDING')
    `);
    insertOutbox.run(CENTRE_UNSYNCED_SYNC_ID, 't_centres');
    insertOutbox.run(AGENT_UNSYNCED_SYNC_ID, 't_users');
    insertOutbox.run(`${AGENT_UNSYNCED_SYNC_ID}_OPERATEUR_VERIFICATION`, 't_user_roles');
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('nettoie en cascade les entrées Outbox des centres, agents et rôles supprimés avec le site', () => {
    hierarchyQueries.deleteSite(SITE_ID);

    // ── Purge locale : site, centres, agents (hors SUPER ADMIN) et rôles disparus ──
    expect(db.prepare('SELECT COUNT(*) AS c FROM t_sites WHERE id = ?').get(SITE_ID)).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM t_centres WHERE site_id = ?').get(SITE_ID)).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM t_users WHERE site_id = ? AND role != 'SUPER ADMIN'").get(SITE_ID)).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM t_user_roles WHERE id_user IN (?, ?)').get(agentSyncedId, agentUnsyncedId)).toMatchObject({ c: 0 });

    // ── SUPER ADMIN neutralisé, jamais supprimé (comportement préexistant intact) ──
    const superAdmin = db.prepare("SELECT site_id, role FROM t_users WHERE sync_id = ?").get(SUPERADMIN_SYNC_ID) as any;
    expect(superAdmin).toBeDefined();
    expect(superAdmin.role).toBe('SUPER ADMIN');
    expect(superAdmin.site_id).toBeNull();

    // ── Centre déjà synchronisé : un DELETE doit être enfilé dans t_outbox ──
    const centreSyncedOutbox = db.prepare("SELECT operation, status FROM t_outbox WHERE id = ?").get(CENTRE_SYNCED_SYNC_ID) as any;
    expect(centreSyncedOutbox).toBeDefined();
    expect(centreSyncedOutbox.operation).toBe('DELETE');
    expect(centreSyncedOutbox.status).toBe('PENDING');

    // ── Centre jamais synchronisé : l'INSERT PENDING doit être annulé, aucun DELETE enfilé ──
    const centreUnsyncedOutbox = db.prepare("SELECT * FROM t_outbox WHERE id = ?").get(CENTRE_UNSYNCED_SYNC_ID);
    expect(centreUnsyncedOutbox).toBeUndefined();

    // ── Agent déjà synchronisé : un DELETE doit être enfilé ──
    const agentSyncedOutbox = db.prepare("SELECT operation, status FROM t_outbox WHERE id = ?").get(AGENT_SYNCED_SYNC_ID) as any;
    expect(agentSyncedOutbox).toBeDefined();
    expect(agentSyncedOutbox.operation).toBe('DELETE');
    expect(agentSyncedOutbox.status).toBe('PENDING');

    // ── Agent jamais synchronisé : l'INSERT PENDING doit être annulé, aucun DELETE enfilé ──
    const agentUnsyncedOutbox = db.prepare("SELECT * FROM t_outbox WHERE id = ?").get(AGENT_UNSYNCED_SYNC_ID);
    expect(agentUnsyncedOutbox).toBeUndefined();

    // ── Rôles multiples de l'agent synchronisé : un DELETE global doit être enfilé ──
    const rolesDelOutbox = db.prepare("SELECT operation, status, payload FROM t_outbox WHERE id = ?").get(`${AGENT_SYNCED_SYNC_ID}_roles_del`) as any;
    expect(rolesDelOutbox).toBeDefined();
    expect(rolesDelOutbox.operation).toBe('DELETE');
    expect(JSON.parse(rolesDelOutbox.payload)).toMatchObject({ sync_id: AGENT_SYNCED_SYNC_ID });

    // ── Rôle de l'agent jamais synchronisé : l'INSERT PENDING doit être annulé ──
    const roleUnsyncedInsertOutbox = db.prepare("SELECT * FROM t_outbox WHERE id = ?").get(`${AGENT_UNSYNCED_SYNC_ID}_OPERATEUR_VERIFICATION`);
    expect(roleUnsyncedInsertOutbox).toBeUndefined();
    // Un DELETE global est tout de même enfilé pour cet agent (idempotent côté Supabase).
    const roleUnsyncedDelOutbox = db.prepare("SELECT operation FROM t_outbox WHERE id = ?").get(`${AGENT_UNSYNCED_SYNC_ID}_roles_del`) as any;
    expect(roleUnsyncedDelOutbox).toBeDefined();
    expect(roleUnsyncedDelOutbox.operation).toBe('DELETE');

    // ── Le DELETE du site lui-même reste enfilé (comportement préexistant intact) ──
    const siteOutbox = db.prepare("SELECT operation FROM t_outbox WHERE id = ?").get(SITE_SYNC_ID) as any;
    expect(siteOutbox).toBeDefined();
    expect(siteOutbox.operation).toBe('DELETE');
  });
});
