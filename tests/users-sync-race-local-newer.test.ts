import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Course synchro descendante des comptes (relevée en test réel) : un UPDATE local (désactivation) est poussé
 * au cloud APRÈS le début de la lecture cloud d'un downstream ; l'écriture locale de l'ancienne valeur cloud
 * ne doit pas ressusciter l'état précédent. Base jetable, client Supabase mocké, jamais la production.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-users-race-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

const SITE = 978;
let cloudUsers: any[] = [];
/** Appelé APRÈS que le mock a figé les données renvoyées (= « le push arrive pendant la lecture »). */
let afterUsersRead: (() => void) | null = null;
vi.mock('../src/main/sync/supabase-client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const run = () => {
        if (table === 't_sites') return { data: [{ id: SITE, nom: 'S_RC', code: 'S_RC', is_active: 1, max_centres: 4, sync_id: 'site-rc' }], error: null };
        if (table === 't_user_roles') return { data: [], error: null };
        const snapshot = cloudUsers.filter(u => filters.every(([c, v]) => u[c] === v)).map(u => ({ ...u }));
        if (afterUsersRead) { const f = afterUsersRead; afterUsersRead = null; f(); }
        return { data: snapshot, error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        in: () => builder,
        abortSignal: () => Promise.resolve(run()),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
      };
      return builder;
    }
  })
}));

let n = 0;
describe('course lecture cloud / push : local plus récent (users-sync.helper)', () => {
  let connection: typeof import('../src/main/database/connection');
  let helper: typeof import('../src/main/sync/users-sync.helper');
  let downstream: typeof import('../src/main/sync/downstream');
  let queries: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    helper = await import('../src/main/sync/users-sync.helper');
    downstream = await import('../src/main/sync/downstream');
    queries = await import('../src/main/database/queries/users.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'S_RC', 'S_RC', 1, 'site-rc')`).run(SITE);
  });
  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  beforeEach(() => { cloudUsers = []; afterUsersRead = null; });

  const uid = () => ++n;
  const cloudRow = (login: string, syncId: string, over: Record<string, unknown> = {}) => ({
    login, password_hash: 'cloud-hash', role: 'OPERATEUR_VERIFICATION', nom_user: 'N', prenom_user: 'P',
    site_id: SITE, centre_id: null, statut_actif: 1, sync_id: syncId, ...over
  });
  /** Ligne locale propre dont synced_at vaut `syncedAtSql` (expression SQL), statut 1. */
  const local = (login: string, syncId: string, syncedAtSql: string | null): number =>
    Number(db.prepare(
      `INSERT INTO t_users (login, password_hash, role, nom_user, site_id, sync_id, is_dirty, statut_actif, synced_at)
       VALUES (?, 'old-hash', 'OPERATEUR_VERIFICATION', 'Local', ?, ?, 0, 1, ${syncedAtSql ?? 'NULL'})`
    ).run(login, SITE, syncId).lastInsertRowid);
  const row = (id: number) => db.prepare('SELECT * FROM t_users WHERE id_user = ?').get(id) as any;
  /** Simule : désactivation locale (dirty) puis push réussi (_clearLocalDirtyFlag : is_dirty=0, synced_at=now). */
  const deactivateAndPush = (id: number) => {
    db.prepare(`UPDATE t_users SET statut_actif = 0, updated_at = datetime('now'), is_dirty = 1 WHERE id_user = ?`).run(id);
    db.prepare(`UPDATE t_users SET is_dirty = 0, synced_at = datetime('now') WHERE id_user = ?`).run(id);
  };

  it('REPRODUCTION (sans readAt = comportement antérieur) : la valeur cloud périmée ressuscite le compte désactivé', () => {
    const k = uid();
    const id = local(`race_a_${k}`, `sid-ra-${k}`, `datetime('now','-1 hour')`);
    deactivateAndPush(id);
    const r = helper.upsertCloudUser(db, cloudRow(`race_a_${k}`, `sid-ra-${k}`) as any, { statutFromCloud: true });
    expect(r.action).toBe('updated');
    expect(row(id).statut_actif).toBe(1); // bug : désactivation perdue localement
  });

  it('CORRIGÉ : avec readAt, la ligne synchronisée après le début de la lecture est ignorée, désactivation conservée', () => {
    const k = uid();
    const id = local(`race_b_${k}`, `sid-rb-${k}`, `datetime('now','-1 hour')`);
    const readAt = Date.now();
    deactivateAndPush(id);
    const r = helper.upsertCloudUser(db, cloudRow(`race_b_${k}`, `sid-rb-${k}`) as any, { statutFromCloud: true, readAt });
    expect(r.action).toBe('skipped_dirty');
    expect(r.reason).toContain('local plus récent');
    expect(row(id)).toMatchObject({ statut_actif: 0, is_dirty: 0, password_hash: 'old-hash' });
  });

  it('une modification cloud réellement plus récente descend (synced_at local antérieur au début de lecture)', () => {
    const k = uid();
    const id = local(`race_c_${k}`, `sid-rc-${k}`, `datetime('now','-10 seconds')`);
    const readAt = Date.now();
    const r = helper.upsertCloudUser(db, cloudRow(`race_c_${k}`, `sid-rc-${k}`, { nom_user: 'Renomme', role: 'OPERATEUR_QUALITE', password_hash: 'new-hash' }) as any, { statutFromCloud: true, readAt });
    expect(r.action).toBe('updated');
    expect(row(id)).toMatchObject({ nom_user: 'Renomme', role: 'OPERATEUR_QUALITE', password_hash: 'new-hash', is_dirty: 0 });
  });

  it('tolérance : synced_at (tronqué à la seconde) dans la seconde de readAt -> ignoré, appliqué au tick suivant (jamais bloqué)', () => {
    const k = uid();
    const id = local(`race_d_${k}`, `sid-rd-${k}`, `datetime('now')`);
    const readAt = Date.now();
    expect(helper.upsertCloudUser(db, cloudRow(`race_d_${k}`, `sid-rd-${k}`, { nom_user: 'Tick' }) as any, { readAt }).action).toBe('skipped_dirty');
    expect(helper.upsertCloudUser(db, cloudRow(`race_d_${k}`, `sid-rd-${k}`, { nom_user: 'Tick' }) as any, { readAt: readAt + 2000 }).action).toBe('updated');
    expect(row(id).nom_user).toBe('Tick');
  });

  it('ligne sans synced_at (NULL) ou illisible : comportement inchangé (appliquée)', () => {
    const k = uid();
    const idNull = local(`race_e_${k}`, `sid-re-${k}`, null);
    expect(helper.upsertCloudUser(db, cloudRow(`race_e_${k}`, `sid-re-${k}`) as any, { readAt: Date.now() }).action).toBe('updated');
    expect(row(idNull).password_hash).toBe('cloud-hash');
    const k2 = uid();
    const idBad = local(`race_f_${k2}`, `sid-rf-${k2}`, `'pas-une-date'`);
    expect(helper.upsertCloudUser(db, cloudRow(`race_f_${k2}`, `sid-rf-${k2}`) as any, { readAt: Date.now() }).action).toBe('updated');
    expect(row(idBad).password_hash).toBe('cloud-hash');
  });

  it('les cas existants priment toujours : dirty / -1 / insertion d\'un compte inconnu', () => {
    const k = uid();
    const dirty = local(`race_g_${k}`, `sid-rg-${k}`, null);
    db.prepare('UPDATE t_users SET is_dirty = 1 WHERE id_user = ?').run(dirty);
    expect(helper.upsertCloudUser(db, cloudRow(`race_g_${k}`, `sid-rg-${k}`) as any, { readAt: Date.now() }).action).toBe('skipped_dirty');
    const del = local(`race_h_${k}`, `sid-rh-${k}`, null);
    db.prepare('UPDATE t_users SET statut_actif = -1, is_dirty = -1 WHERE id_user = ?').run(del);
    expect(helper.upsertCloudUser(db, cloudRow(`race_h_${k}`, `sid-rh-${k}`) as any, { readAt: Date.now() }).action).toBe('skipped_deleted');
    expect(helper.upsertCloudUser(db, cloudRow(`race_i_${k}`, `sid-ri-${k}`) as any, { readAt: Date.now() }).action).toBe('inserted');
  });

  it('syncUsersFromCloud : push arrivant PENDANT la lecture cloud -> la désactivation locale survit', async () => {
    const k = uid();
    const id = local(`race_j_${k}`, `sid-rj-${k}`, `datetime('now','-1 hour')`);
    cloudUsers = [cloudRow(`race_j_${k}`, `sid-rj-${k}`)];
    afterUsersRead = () => deactivateAndPush(id);
    await downstream.syncUsersFromCloud(SITE);
    expect(row(id)).toMatchObject({ statut_actif: 0, is_dirty: 0 });
  });

  it('pullAgentsFromCloud : push arrivant PENDANT la lecture cloud -> la désactivation locale survit', async () => {
    const k = uid();
    const id = local(`race_k_${k}`, `sid-rk-${k}`, `datetime('now','-1 hour')`);
    cloudUsers = [cloudRow(`race_k_${k}`, `sid-rk-${k}`)];
    afterUsersRead = () => deactivateAndPush(id);
    const res = await queries.pullAgentsFromCloud(SITE);
    expect(res.success).toBe(true);
    expect(row(id)).toMatchObject({ statut_actif: 0, is_dirty: 0 });
  });

  it('syncUsersFromCloud : cloud réellement modifié (rien de local récent) descend toujours', async () => {
    const k = uid();
    const id = local(`race_l_${k}`, `sid-rl-${k}`, `datetime('now','-1 hour')`);
    cloudUsers = [cloudRow(`race_l_${k}`, `sid-rl-${k}`, { nom_user: 'CloudNom', role: 'OPERATEUR_QUALITE' })];
    await downstream.syncUsersFromCloud(SITE);
    expect(row(id)).toMatchObject({ nom_user: 'CloudNom', role: 'OPERATEUR_QUALITE', statut_actif: 1 });
  });

  it('journalisation : chaque raison de skip est tracée avec le login, sans fuite de hash, plafonnée à 20 + résumé', async () => {
    const log = (await import('electron-log')).default;
    const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    helper.flushSkipLogSummary();
    spy.mockClear();
    const k = uid();
    const dirty = local(`lg_d_${k}`, `sid-lgd-${k}`, null);
    db.prepare('UPDATE t_users SET is_dirty = 1 WHERE id_user = ?').run(dirty);
    const del = local(`lg_x_${k}`, `sid-lgx-${k}`, null);
    db.prepare('UPDATE t_users SET statut_actif = -1, is_dirty = -1 WHERE id_user = ?').run(del);
    const newer = local(`lg_n_${k}`, `sid-lgn-${k}`, `datetime('now')`);
    const pend = local(`lg_p_${k}`, `sid-lgp-${k}`, null);
    db.prepare(`INSERT INTO t_outbox (id, table_name, operation, payload, status) VALUES (?, 't_users', 'UPDATE', '{}', 'PENDING')`)
      .run(`sid-lgp-${k}`);
    void newer; void pend;
    const mk = (l: string, s: string) => cloudRow(l, s, { password_hash: 'SECRET-HASH-XYZ' }) as any;
    helper.upsertCloudUser(db, mk(`lg_d_${k}`, `sid-lgd-${k}`), { readAt: Date.now() });
    helper.upsertCloudUser(db, mk(`lg_x_${k}`, `sid-lgx-${k}`), { readAt: Date.now() });
    helper.upsertCloudUser(db, mk(`lg_n_${k}`, `sid-lgn-${k}`), { readAt: Date.now() });
    helper.upsertCloudUser(db, mk(`lg_p_${k}`, `sid-lgp-${k}`), { readAt: Date.now() });
    const lines = spy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => l.includes(`lg_d_${k}`) && l.includes('is_dirty=1'))).toBe(true);
    expect(lines.some(l => l.includes(`lg_x_${k}`) && l.includes('supprimée (-1)'))).toBe(true);
    expect(lines.some(l => l.includes(`lg_n_${k}`) && l.includes('local plus récent'))).toBe(true);
    expect(lines.some(l => l.includes(`lg_p_${k}`) && l.includes('t_outbox'))).toBe(true);
    expect(lines.join(' | ')).not.toContain('SECRET-HASH-XYZ');
    expect(lines.join(' | ')).not.toContain('old-hash');

    // plafond : 30 comptes sales -> au plus 20 lignes détaillées (4 déjà consommées) puis un résumé
    helper.flushSkipLogSummary(); spy.mockClear();
    for (let i = 0; i < 30; i++) {
      const id = local(`lg_m${i}_${k}`, `sid-lgm${i}-${k}`, null);
      db.prepare('UPDATE t_users SET is_dirty = 1 WHERE id_user = ?').run(id);
      helper.upsertCloudUser(db, mk(`lg_m${i}_${k}`, `sid-lgm${i}-${k}`));
    }
    const detail = spy.mock.calls.map(c => String(c[0])).filter(l => l.includes('Compte ignoré'));
    expect(detail.length).toBe(20);
    helper.flushSkipLogSummary();
    expect(spy.mock.calls.map(c => String(c[0])).some(l => l.includes('10 autre(s) compte(s) ignoré(s)'))).toBe(true);
    spy.mockRestore();
  });
});
