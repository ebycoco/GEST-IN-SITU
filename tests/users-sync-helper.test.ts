import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LOT 2 (L2-0 + L2-1a) :
 *  - upsertCloudUser (src/main/sync/users-sync.helper.ts) : renommage, adoption, conflits, lignes sales, etc.
 *  - syncCurrentUserActiveStatus (downstream.ts) : recherche par sync_id, jamais de désactivation sur « non trouvé »
 *    (client Supabase mocké).
 * Base jetable (répertoire temporaire), jamais la base réelle.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-helper-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

// Client Supabase mocké : table t_users en mémoire, filtres .eq() appliqués.
const cloudUsers: { login: string; statut_actif: number; sync_id: string; site_id: number }[] = [];
let cloudError: { message: string } | null = null;
let cloudThrow = false;
const queriesSeen: string[] = [];
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: () => {
      const filters: [string, unknown][] = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
        abortSignal: () => {
          if (cloudThrow) return Promise.reject(new Error('network down'));
          queriesSeen.push(filters.map(f => f[0]).join('+'));
          if (cloudError) return Promise.resolve({ data: null, error: cloudError });
          const data = cloudUsers.filter(u => filters.every(([c, v]) => (u as any)[c] === v));
          return Promise.resolve({ data, error: null });
        }
      };
      return builder;
    }
  })
}));

const SITE = 975;
const CENTRE = 9751;
let n = 0;

describe('upsertCloudUser + syncCurrentUserActiveStatus (LOT 2)', () => {
  let connection: typeof import('../src/main/database/connection');
  let helper: typeof import('../src/main/sync/users-sync.helper');
  let downstream: typeof import('../src/main/sync/downstream');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    helper = await import('../src/main/sync/users-sync.helper');
    downstream = await import('../src/main/sync/downstream');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_UH', 'S_UH', 1, 'site-uh')`).run(SITE);
    db.prepare(`INSERT OR IGNORE INTO t_centres (id, nom, code, site_id, sync_id) VALUES (?, 'C_UH', 'C_UH', ?, 'centre-uh')`).run(CENTRE, SITE);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const uid = () => ++n;
  function local(login: string, syncId: string | null, extra: { dirty?: number; statut?: number; role?: string } = {}): number {
    return Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, site_id, sync_id, is_dirty, statut_actif) VALUES (?, 'old-hash', ?, ?, ?, ?, ?)`
    ).run(login, extra.role ?? 'OPERATEUR_VERIFICATION', SITE, syncId, extra.dirty ?? 0, extra.statut ?? 1).lastInsertRowid);
  }
  function cloud(login: string, syncId: string, over: Record<string, unknown> = {}): import('../src/main/sync/users-sync.helper').CloudUserRow {
    return { login, password_hash: 'new-hash', role: 'OPERATEUR_QUALITE', nom_user: 'N', prenom_user: 'P', site_id: SITE, centre_id: null, statut_actif: 1, sync_id: syncId, ...over } as any;
  }
  const row = (id: number) => db.prepare('SELECT * FROM t_users WHERE id_user = ?').get(id) as any;
  const roles = (id: number) => (db.prepare('SELECT role FROM t_user_roles WHERE id_user = ? ORDER BY role').all(id) as { role: string }[]).map(r => r.role);

  describe('upsertCloudUser', () => {
    it('insertion d\'un compte inconnu', () => {
      const k = uid();
      const r = helper.upsertCloudUser(db, cloud(`new_${k}`, `sid-new-${k}`, { centre_id: CENTRE, roles: ['OPERATEUR_SAISIE', 'ROLE_BIDON'] }));
      expect(r.action).toBe('inserted');
      const u = row(r.id_user!);
      expect(u).toMatchObject({ login: `new_${k}`, sync_id: `sid-new-${k}`, is_dirty: 0, centre_id: CENTRE, password_hash: 'new-hash' });
      expect(roles(r.id_user!)).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    });

    it('renommage : sync_id trouvé, login différent, libre -> renamed', () => {
      const k = uid();
      const id = local(`old_${k}`, `sid-ren-${k}`);
      const r = helper.upsertCloudUser(db, cloud(`renamed_${k}`, `sid-ren-${k}`));
      expect(r).toMatchObject({ action: 'renamed', id_user: id });
      expect(row(id)).toMatchObject({ login: `renamed_${k}`, role: 'OPERATEUR_QUALITE', is_dirty: 0 });
    });

    it('renommage vers un login détenu par une autre ligne -> skipped_conflict, rien d\'écrasé', () => {
      const k = uid();
      const id = local(`a_${k}`, `sid-c1-${k}`);
      local(`b_${k}`, `sid-c2-${k}`);
      const r = helper.upsertCloudUser(db, cloud(`b_${k}`, `sid-c1-${k}`));
      expect(r.action).toBe('skipped_conflict');
      expect(row(id)).toMatchObject({ login: `a_${k}`, password_hash: 'old-hash', role: 'OPERATEUR_VERIFICATION' });
    });

    it('adoption : login trouvé avec sync_id local NULL -> sync_id cloud posé', () => {
      const k = uid();
      const id = local(`adopt_${k}`, null);
      const r = helper.upsertCloudUser(db, cloud(`adopt_${k}`, `sid-ad-${k}`));
      expect(r).toMatchObject({ action: 'adopted', id_user: id });
      expect(row(id)).toMatchObject({ sync_id: `sid-ad-${k}`, password_hash: 'new-hash' });
    });

    it('deux sync_id pour le même login : sync_id local différent -> skipped_conflict, aucun écrasement', () => {
      const k = uid();
      const id = local(`dup_${k}`, `sid-first-${k}`);
      const r = helper.upsertCloudUser(db, cloud(`dup_${k}`, `sid-second-${k}`));
      expect(r.action).toBe('skipped_conflict');
      expect(r.reason).toContain(`dup_${k}`);
      expect(r.reason).not.toContain('new-hash');
      expect(row(id)).toMatchObject({ sync_id: `sid-first-${k}`, password_hash: 'old-hash' });
    });

    it('ligne locale sale (is_dirty=1) -> skipped_dirty, aucune colonne écrasée, rôles intacts', () => {
      const k = uid();
      const id = local(`dirty_${k}`, `sid-d-${k}`, { dirty: 1 });
      db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_VERIFICATION')`).run(id);
      const r = helper.upsertCloudUser(db, cloud(`dirty_${k}`, `sid-d-${k}`, { roles: ['OPERATEUR_SAISIE'] }));
      expect(r.action).toBe('skipped_dirty');
      expect(row(id)).toMatchObject({ password_hash: 'old-hash', role: 'OPERATEUR_VERIFICATION', is_dirty: 1 });
      expect(roles(id)).toEqual(['OPERATEUR_VERIFICATION']);
    });

    it.each(['PENDING', 'ERROR'])('outbox %s (id = sync_id) -> skipped_pending_outbox', (status) => {
      const k = uid();
      const id = local(`ob_${status}_${k}`, `sid-ob-${status}-${k}`);
      db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', ?)`).run(`sid-ob-${status}-${k}`, status);
      const r = helper.upsertCloudUser(db, cloud(`ob_${status}_${k}`, `sid-ob-${status}-${k}`));
      expect(r.action).toBe('skipped_pending_outbox');
      expect(row(id).password_hash).toBe('old-hash');
    });

    it('outbox id = sync_id || "_suffixe" (LIKE) -> skipped_pending_outbox ; SYNCED ne bloque pas', () => {
      const k = uid();
      const id = local(`obl_${k}`, `sid-obl-${k}`);
      db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', 'SYNCED')`).run(`sid-obl-${k}_1`);
      expect(helper.upsertCloudUser(db, cloud(`obl_${k}`, `sid-obl-${k}`)).action).toBe('updated');
      db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', 'PENDING')`).run(`sid-obl-${k}_2`);
      expect(helper.upsertCloudUser(db, cloud(`obl_${k}`, `sid-obl-${k}`, { password_hash: 'h3' })).action).toBe('skipped_pending_outbox');
      expect(row(id).password_hash).toBe('new-hash');
    });

    it('ligne supprimée (statut -1 ou is_dirty -1) -> skipped_deleted, jamais ressuscitée', () => {
      const k = uid();
      const a = local(`del1_${k}`, `sid-del1-${k}`, { statut: -1 });
      const b = local(`del2_${k}`, `sid-del2-${k}`, { dirty: -1 });
      expect(helper.upsertCloudUser(db, cloud(`del1_${k}`, `sid-del1-${k}`)).action).toBe('skipped_deleted');
      expect(helper.upsertCloudUser(db, cloud(`del2_${k}`, `sid-del2-${k}`)).action).toBe('skipped_deleted');
      expect(row(a)).toMatchObject({ statut_actif: -1, password_hash: 'old-hash' });
      expect(row(b)).toMatchObject({ is_dirty: -1, password_hash: 'old-hash' });
    });

    it('rôle cloud invalide -> skipped_invalid, rien créé', () => {
      const k = uid();
      const r = helper.upsertCloudUser(db, cloud(`inv_${k}`, `sid-inv-${k}`, { role: 'ADMINISTRATEUR' }));
      expect(r.action).toBe('skipped_invalid');
      expect(db.prepare('SELECT COUNT(*) c FROM t_users WHERE login = ?').get(`inv_${k}`)).toEqual({ c: 0 });
    });

    it('rôles remplacés sur ligne propre, avec id_user retourné', () => {
      const k = uid();
      const id = local(`rr_${k}`, `sid-rr-${k}`);
      db.prepare(`INSERT INTO t_user_roles (id_user, role) VALUES (?, 'OPERATEUR_INVENTAIRE')`).run(id);
      const r = helper.upsertCloudUser(db, cloud(`rr_${k}`, `sid-rr-${k}`, { roles: ['OPERATEUR_SAISIE'] }));
      expect(r.id_user).toBe(id);
      expect(roles(id)).toEqual(['OPERATEUR_QUALITE', 'OPERATEUR_SAISIE']);
    });

    it('SUPER ADMIN local non rétrogradé par une valeur cloud erronée', () => {
      const k = uid();
      const id = local(`sa_${k}`, `sid-sa-${k}`, { role: 'SUPER ADMIN' });
      const r = helper.upsertCloudUser(db, cloud(`sa_${k}`, `sid-sa-${k}`, { role: 'OPERATEUR_SAISIE' }));
      expect(r.action).toBe('skipped_conflict');
      expect(row(id)).toMatchObject({ role: 'SUPER ADMIN', password_hash: 'old-hash' });
    });

    it('centre inexistant localement : insertion avec centre NULL, mise à jour avec centre local conservé', () => {
      const k = uid();
      const ins = helper.upsertCloudUser(db, cloud(`ce_${k}`, `sid-ce-${k}`, { centre_id: 424242 }));
      expect(ins.action).toBe('inserted');
      expect(ins.reason).toContain('424242');
      expect(row(ins.id_user!).centre_id).toBeNull();

      const k2 = uid();
      const id = local(`ce2_${k2}`, `sid-ce2-${k2}`);
      db.prepare('UPDATE t_users SET centre_id = ? WHERE id_user = ?').run(CENTRE, id);
      const upd = helper.upsertCloudUser(db, cloud(`ce2_${k2}`, `sid-ce2-${k2}`, { centre_id: 424242 }));
      expect(upd.action).toBe('updated');
      expect(row(id).centre_id).toBe(CENTRE);
    });

    it('site inexistant localement à l\'insertion -> skipped_invalid sans exception', () => {
      const k = uid();
      expect(helper.upsertCloudUser(db, cloud(`si_${k}`, `sid-si-${k}`, { site_id: 31337 })).action).toBe('skipped_invalid');
    });

    it('statutFromCloud=false force statut_actif=1 ; défaut reprend la valeur cloud', () => {
      const k = uid();
      const a = helper.upsertCloudUser(db, cloud(`st1_${k}`, `sid-st1-${k}`, { statut_actif: 0 }));
      expect(row(a.id_user!).statut_actif).toBe(0);
      const b = helper.upsertCloudUser(db, cloud(`st2_${k}`, `sid-st2-${k}`, { statut_actif: 0 }), { statutFromCloud: false });
      expect(row(b.id_user!).statut_actif).toBe(1);
    });

    it('atomicité d\'un lot : une ligne en échec n\'annule pas les autres (et n\'écrit rien d\'elle)', () => {
      const k = uid();
      const outer = db.transaction(() => [
        helper.upsertCloudUser(db, cloud(`lot_ok1_${k}`, `sid-lot1-${k}`)),
        helper.upsertCloudUser(db, cloud(`lot_ko_${k}`, `sid-lotko-${k}`, { role: 'NOPE' })),
        // exception SQL réelle au milieu de la ligne : trigger qui bloque l'insertion de t_user_roles pour ce login
        (() => {
          db.exec(`CREATE TRIGGER trg_lot_block BEFORE INSERT ON t_user_roles WHEN new.role = 'OPERATEUR_APUREMENT' BEGIN SELECT RAISE(ABORT, 'blocage test'); END`);
          try { return helper.upsertCloudUser(db, cloud(`lot_exc_${k}`, `sid-lotexc-${k}`, { role: 'OPERATEUR_APUREMENT' })); }
          finally { db.exec('DROP TRIGGER trg_lot_block'); }
        })(),
        helper.upsertCloudUser(db, cloud(`lot_ok2_${k}`, `sid-lot2-${k}`))
      ]);
      const res = outer();
      expect(res.map(r => r.action)).toEqual(['inserted', 'skipped_invalid', 'skipped_invalid', 'inserted']);
      expect(res[2].reason).toContain('blocage test');
      const cnt = (l: string) => (db.prepare('SELECT COUNT(*) c FROM t_users WHERE login = ?').get(l) as { c: number }).c;
      expect(cnt(`lot_ok1_${k}`)).toBe(1);
      expect(cnt(`lot_ok2_${k}`)).toBe(1);
      expect(cnt(`lot_exc_${k}`)).toBe(0); // savepoint de la ligne annulé
    });
  });

  describe('syncCurrentUserActiveStatus (L2-0, supabase mocké)', () => {
    const reset = () => { cloudUsers.length = 0; cloudError = null; cloudThrow = false; queriesSeen.length = 0; };

    it('login renommé côté cloud : trouvé par sync_id, compte local resté actif', async () => {
      reset();
      const k = uid();
      const id = local(`cur_${k}`, `sid-cur-${k}`);
      cloudUsers.push({ login: `cur_${k}_renomme`, statut_actif: 1, sync_id: `sid-cur-${k}`, site_id: SITE });
      await downstream.syncCurrentUserActiveStatus(`cur_${k}`, SITE);
      expect(row(id).statut_actif).toBe(1);
      expect(queriesSeen[0]).toBe('sync_id+site_id');
    });

    it('ligne introuvable côté cloud (ni sync_id ni login) : AUCUNE désactivation locale', async () => {
      reset();
      const k = uid();
      const id = local(`gone_${k}`, `sid-gone-${k}`);
      await downstream.syncCurrentUserActiveStatus(`gone_${k}`, SITE);
      expect(row(id).statut_actif).toBe(1);
      expect(queriesSeen).toEqual(['sync_id+site_id', 'login+site_id']);
    });

    it('cloud répond statut_actif=0 pour la bonne ligne (même renommée) : désactivation locale', async () => {
      reset();
      const k = uid();
      const id = local(`off_${k}`, `sid-off-${k}`);
      cloudUsers.push({ login: `off_${k}_x`, statut_actif: 0, sync_id: `sid-off-${k}`, site_id: SITE });
      await downstream.syncCurrentUserActiveStatus(`off_${k}`, SITE);
      expect(row(id)).toMatchObject({ statut_actif: 0, is_dirty: 0, password_hash: 'old-hash' });
    });

    it('repli par login quand le compte local n\'a pas de sync_id', async () => {
      reset();
      const k = uid();
      const id = local(`nosid_${k}`, null);
      cloudUsers.push({ login: `nosid_${k}`, statut_actif: 0, sync_id: `x-${k}`, site_id: SITE });
      await downstream.syncCurrentUserActiveStatus(`nosid_${k}`, SITE);
      expect(row(id).statut_actif).toBe(0);
      expect(queriesSeen).toEqual(['login+site_id']);
    });

    it('erreur Supabase ou réseau : état local inchangé (fail-open conservé)', async () => {
      const k = uid();
      const id = local(`err_${k}`, `sid-err-${k}`);
      reset(); cloudError = { message: 'boom' };
      await downstream.syncCurrentUserActiveStatus(`err_${k}`, SITE);
      reset(); cloudThrow = true;
      await downstream.syncCurrentUserActiveStatus(`err_${k}`, SITE);
      expect(row(id).statut_actif).toBe(1);
    });
  });
});
