import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Lot 1 (D3) — le filtre de nom de la vue « Dates invalides » était sans effet : le handler IPC
 * `cartes:getInvalidDates` ne déclarait que 3 paramètres et ne transmettait jamais `query` à
 * `getInvalidDateRecords`. Ce test exerce le VRAI handler enregistré par registerIpcHandlers
 * (contrôle de rôle réel via t_users, cloisonnement via getSecureCurrentUser mocké), base SQLite jetable.
 *
 * Preuve de non-régression : sur l'ancien handler, `query` est ignoré -> les cas « avec query »
 * (liste ET total filtrés, multi-jetons, anomalies, pagination filtrée) retournent la liste complète
 * (total 4 au lieu de 3/1/...) et échouent.
 */
process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-dates-invalides-'));

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
  getCurrentUserLogin: vi.fn(() => 'di.superadmin'),
  getSecureCurrentUser: vi.fn(() => null),
  setActiveRole: vi.fn(),
  getCurrentGrantedRoles: vi.fn(() => []),
  refreshSecureCurrentUser: vi.fn()
}));

type Row = { id_carte: number; noms: string; prenoms: string; site_id: number; source: string };
type Page = { rows: Row[]; total: number };

describe('handler cartes:getInvalidDates — filtre de nom (lot 1 / D3)', () => {
  let connection: typeof import('../src/main/database/connection');
  let db: import('better-sqlite3').Database;
  let heartbeat: typeof import('../src/main/auth/session-heartbeat');
  let getInvalidDates: (e: unknown, ...args: unknown[]) => Promise<Page>;

  const SITE_A = 951;
  const SITE_B = 952;
  const USER_SUPER = 9511;
  const USER_ADMIN_A = 9512;
  const USER_SAISIE_A = 9513;

  let seq = 0;
  const addCarte = (site: number, noms: string, prenoms: string, date: string | null) => {
    seq += 1;
    db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty)
      VALUES (?, ?, ?, ?, 'ABIDJAN', ?, 'R-1', 'EN STOCK', ?, 0)
    `).run(site, noms, prenoms, date, `07000000${seq}`, `sync-di-${seq}`);
  };
  const addAnomalie = (id: number, site: number, noms: string, prenoms: string, type: string) => {
    db.prepare(`
      INSERT INTO t_import_anomalies (id, site_id, carte_id, type_anomalie, noms, prenoms, date_de_naissance, num_secu, contact)
      VALUES (?, ?, ?, ?, ?, ?, '99/99/1999', ?, '0500000000')
    `).run(id, site, `${id}`, type, noms, prenoms, `${id}`.padEnd(13, '0'));
  };

  const loginAs = (id_user: number, role: string, site_id: number | null) => {
    vi.mocked(heartbeat.getSecureCurrentUser).mockReturnValue(
      { id_user, login: `u${id_user}`, role, site_id, centre_id: null } as unknown as ReturnType<typeof heartbeat.getSecureCurrentUser>
    );
  };
  const noms = (res: Page) => res.rows.map(r => `${r.noms} ${r.prenoms}`).sort();

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    const handlers = await import('../src/main/ipc/handlers');
    heartbeat = await import('../src/main/auth/session-heartbeat');
    db = await connection.initDatabase();

    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DI_A', 'SITE_DI_A', 1, 'site-di-a')`).run(SITE_A);
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_DI_B', 'SITE_DI_B', 1, 'site-di-b')`).run(SITE_B);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'di.superadmin', 'x', 'SUPER ADMIN', 'Test', 1, NULL)`).run(USER_SUPER);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'di.admin.a', 'x', 'ADMINISTRATEUR_SITE', 'Test', 1, ?)`).run(USER_ADMIN_A, SITE_A);
    db.prepare(`INSERT INTO t_users (id_user, login, password_hash, role, nom_user, statut_actif, site_id) VALUES (?, 'di.saisie.a', 'x', 'OPERATEUR_SAISIE', 'Test', 1, ?)`).run(USER_SAISIE_A, SITE_A);

    // Site A : 3 cartes à date invalide + 1 carte valide (exclue) + 1 anomalie DATE_INVALIDE
    // + 1 anomalie d'un autre type (exclue).
    addCarte(SITE_A, 'DUPONT', 'Jean', '15/03/1985');
    addCarte(SITE_A, 'DUPONT', 'Marie', null);
    addCarte(SITE_A, 'KOUAME', 'Paul', '');
    addCarte(SITE_A, 'MARTIN', 'Luc', '1990-01-01');
    addAnomalie(5001, SITE_A, 'DUPONT', 'Anne', 'DATE_INVALIDE');
    addAnomalie(5002, SITE_A, 'DUPONT', 'Autre', 'DOUBLON');
    // Site B : une carte invalide au même nom que l'une de A.
    addCarte(SITE_B, 'DUPONT', 'Jean', '15/03/1985');

    const { ipcMain } = await import('electron');
    handlers.registerIpcHandlers({ webContents: { send: vi.fn() }, isDestroyed: () => false } as unknown as Parameters<typeof handlers.registerIpcHandlers>[0]);
    getInvalidDates = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'cartes:getInvalidDates')![1] as unknown as typeof getInvalidDates;
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) sans query : toutes les dates invalides du site (3 cartes + 1 anomalie), total complet', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const res = await getInvalidDates({}, SITE_A, 0, 50);
    expect(res.total).toBe(4);
    expect(noms(res)).toEqual(['DUPONT Anne', 'DUPONT Jean', 'DUPONT Marie', 'KOUAME Paul']);
    // query vide / blanc = comportement identique à l'absence de query
    expect((await getInvalidDates({}, SITE_A, 0, 50, '')).total).toBe(4);
    expect((await getInvalidDates({}, SITE_A, 0, 50, '   ')).total).toBe(4);
  });

  it('(b) avec query : liste ET total sont filtrés (pas le total global)', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const res = await getInvalidDates({}, SITE_A, 0, 50, 'KOUAME');
    expect(res.total).toBe(1);
    expect(noms(res)).toEqual(['KOUAME Paul']);

    const res2 = await getInvalidDates({}, SITE_A, 0, 50, 'DUPONT');
    expect(res2.total).toBe(3);
    expect(noms(res2)).toEqual(['DUPONT Anne', 'DUPONT Jean', 'DUPONT Marie']);

    const aucun = await getInvalidDates({}, SITE_A, 0, 50, 'INEXISTANT');
    expect(aucun).toEqual({ rows: [], total: 0 });
  });

  it('(c) plusieurs jetons (nom + prénom) : tous doivent correspondre', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const res = await getInvalidDates({}, SITE_A, 0, 50, 'DUPONT Marie');
    expect(res.total).toBe(1);
    expect(noms(res)).toEqual(['DUPONT Marie']);
    const aucun = await getInvalidDates({}, SITE_A, 0, 50, 'DUPONT Paul');
    expect(aucun.total).toBe(0);
  });

  it('(d) branche t_import_anomalies : trouvée par le filtre, anomalie d\'un autre type exclue', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const res = await getInvalidDates({}, SITE_A, 0, 50, 'DUPONT Anne');
    expect(res.total).toBe(1);
    expect(res.rows[0]).toMatchObject({ noms: 'DUPONT', prenoms: 'Anne', source: 't_import_anomalies' });
    expect((await getInvalidDates({}, SITE_A, 0, 50, 'Autre')).total).toBe(0);
  });

  it('(e) cloisonnement : SUPER ADMIN limité au site demandé ; ADMINISTRATEUR_SITE A recadré sur A même avec siteId forgé = B', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const resB = await getInvalidDates({}, SITE_B, 0, 50, 'DUPONT');
    expect(resB.total).toBe(1);
    expect(resB.rows.every(r => r.site_id === SITE_B)).toBe(true);
    const resA = await getInvalidDates({}, SITE_A, 0, 50, 'DUPONT');
    expect(resA.rows.every(r => r.site_id === SITE_A)).toBe(true);

    loginAs(USER_ADMIN_A, 'ADMINISTRATEUR_SITE', SITE_A);
    const forge = await getInvalidDates({}, SITE_B, 0, 50, 'DUPONT');
    expect(forge.total).toBe(3);
    expect(forge.rows.every(r => r.site_id === SITE_A)).toBe(true);
  });

  it('(f) rôle non autorisé ou session absente : accès refusé', async () => {
    loginAs(USER_SAISIE_A, 'OPERATEUR_SAISIE', SITE_A);
    await expect(getInvalidDates({}, SITE_A, 0, 50, 'DUPONT')).rejects.toThrow(/Accès refusé/);
    vi.mocked(heartbeat.getSecureCurrentUser).mockReturnValue(null);
    await expect(getInvalidDates({}, SITE_A, 0, 50, 'DUPONT')).rejects.toThrow(/Accès refusé/);
  });

  it('(g) pagination avec filtre : total constant, pages disjointes', async () => {
    loginAs(USER_SUPER, 'SUPER ADMIN', null);
    const p1 = await getInvalidDates({}, SITE_A, 0, 2, 'DUPONT');
    const p2 = await getInvalidDates({}, SITE_A, 2, 2, 'DUPONT');
    expect(p1.total).toBe(3);
    expect(p2.total).toBe(3);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(1);
    expect([...noms(p1), ...noms(p2)].sort()).toEqual(['DUPONT Anne', 'DUPONT Jean', 'DUPONT Marie']);
  });
});
