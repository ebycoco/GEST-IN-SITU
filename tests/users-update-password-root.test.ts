import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Règle ROOT (2026-11-01) sur updateUser (users.queries.ts) : poser un mot de passe via
 * users:update sur un compte détenant SUPER ADMIN est réservé au compte ROOT de secours
 * (même règle que resetAgentPassword). Fermeture du contournement SUPER ADMIN -> SUPER ADMIN.
 * Base SQLite TEMPORAIRE ; modules réseau/sync mockés : aucun accès Supabase ni base réelle.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-update-pwd-root-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));
vi.mock('../src/main/sync/outbox.service', () => ({
  enqueueOutbox: vi.fn(),
  scheduleOutboxProcessing: vi.fn(),
  cancelPendingInsert: vi.fn(() => true)
}));
vi.mock('../src/main/sync/network-monitor', () => ({ networkMonitor: { getState: () => 'OFFLINE' } }));
vi.mock('../src/main/sync/supabase-client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../src/main/sync/presence.service', () => ({ recordPresenceLogin: vi.fn() }));
vi.mock('../src/main/utils/audit', () => ({ logAudit: vi.fn() }));

describe('updateUser : mot de passe d\'un SUPER ADMIN réservé à ROOT', () => {
  let connection: typeof import('../src/main/database/connection');
  let uq: typeof import('../src/main/database/queries/users.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 831;
  const ROOT = { id_user: 999999, role: 'SUPER ADMIN', login: 'ROOT' } as const;
  const MSG_ROOT = "seul le compte ROOT de secours peut réinitialiser le mot de passe d'un Super Admin";
  const MSG_SITE = 'Accès non autorisé aux données de ce site';

  type Row = { id_user: number; login: string; password_hash: string; role: string; site_id: number | null; nom_user: string };
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
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, is_permanent, sync_id) VALUES (?, 'SITE_A', 'SITE_A', 1, 1, 'site-sync-831')`).run(SITE_A);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM t_logs').run();
    db.prepare('DELETE FROM t_user_roles').run();
    db.prepare('DELETE FROM t_users').run();
  });

  it('SUPER ADMIN -> SUPER ADMIN avec password : refusé, hash inchangé', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const sa2 = mk('sa2', 'SUPER ADMIN', null);
    expect(() => uq.updateUser(sa2.id_user, { password: 'pirate1' }, caller(sa))).toThrow(MSG_ROOT);
    expect(row('sa2').password_hash).toBe(sa2.password_hash);
  });

  it('SUPER ADMIN -> SUPER ADMIN avec password ET nom : refusé en bloc (rien d\'écrit)', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const sa2 = mk('sa2', 'SUPER ADMIN', null);
    expect(() => uq.updateUser(sa2.id_user, { nom_user: 'Pirate', password: 'pirate1' }, caller(sa))).toThrow(MSG_ROOT);
    expect(row('sa2')).toEqual(sa2);
  });

  it('ROOT -> SUPER ADMIN avec password : accepté, hash changé', () => {
    const sa2 = mk('sa2', 'SUPER ADMIN', null);
    uq.updateUser(sa2.id_user, { password: 'nouveau1' }, ROOT);
    expect(row('sa2').password_hash).not.toBe(sa2.password_hash);
  });

  it('SUPER ADMIN -> SUPER ADMIN sans password (nom) : accepté, comportement inchangé', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const sa2 = mk('sa2', 'SUPER ADMIN', null);
    uq.updateUser(sa2.id_user, { nom_user: 'Modifie' }, caller(sa));
    expect(row('sa2').nom_user).toBe('Modifie');
    expect(row('sa2').password_hash).toBe(sa2.password_hash);
  });

  it('SUPER ADMIN -> SUPER ADMIN avec password vide : pas de changement de mot de passe, pas de refus', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const sa2 = mk('sa2', 'SUPER ADMIN', null);
    uq.updateUser(sa2.id_user, { nom_user: 'Vide', password: '' }, caller(sa));
    expect(row('sa2').nom_user).toBe('Vide');
    expect(row('sa2').password_hash).toBe(sa2.password_hash);
  });

  it('ADMINISTRATEUR_SITE -> SUPER ADMIN avec password : refusé (message historique inchangé)', () => {
    const sa = mk('sa', 'SUPER ADMIN', SITE_A);
    const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
    expect(() => uq.updateUser(sa.id_user, { password: 'pirate1' }, caller(adm))).toThrow(MSG_SITE);
    expect(row('sa').password_hash).toBe(sa.password_hash);
  });

  it('SUPER ADMIN -> ADMINISTRATEUR_SITE avec password : accepté', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const adm = mk('adm', 'ADMINISTRATEUR_SITE', SITE_A);
    uq.updateUser(adm.id_user, { password: 'nouveau1' }, caller(sa));
    expect(row('adm').password_hash).not.toBe(adm.password_hash);
  });

  it('cible multi-rôles (SUPER ADMIN en second rôle seulement) : refusé pour un SUPER ADMIN normal', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    const multi = mk('multi', 'OPERATEUR_SAISIE', SITE_A, ['OPERATEUR_SAISIE', 'SUPER ADMIN']);
    expect(() => uq.updateUser(multi.id_user, { password: 'pirate1' }, caller(sa))).toThrow(MSG_ROOT);
    expect(row('multi').password_hash).toBe(multi.password_hash);
  });

  it('SUPER ADMIN modifiant son PROPRE compte avec password : autorisé (cible = soi-même)', () => {
    const sa = mk('sa', 'SUPER ADMIN', null);
    uq.updateUser(sa.id_user, { password: 'monnouveau1' }, caller(sa));
    expect(row('sa').password_hash).not.toBe(sa.password_hash);
  });
});
