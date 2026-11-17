import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * P2 (diagnostic agent-10) : badge « cartes du centre » via stats:getCentreCardsCount au lieu de
 * stats:get complet. Vérifie contre une vraie base SQLite (migrations de production) que :
 *  - getCentreCardsCount == `total` de getStats (SQL recopié de stats-worker.js) ET de getCentreStats ;
 *  - le jeu mixte (brouillon, is_dirty=-1, doublon, autre centre, autre site) est correctement compté ;
 *  - resolveCentreCardsCountScope (utilisée par le handler) ignore les paramètres forcés des rôles
 *    non-SUPER ADMIN (cloisonnement §3) et refuse session absente / rôle non autorisé.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: true, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('getCentreCardsCount / resolveCentreCardsCountScope', () => {
  let connection: typeof import('../src/main/database/connection');
  let cfg: typeof import('../src/main/database/queries/config.queries');
  let db: import('better-sqlite3').Database;

  const SITE_A = 910, SITE_B = 911;
  let centreA1: number, centreA2: number, centreB1: number;
  let seq = 0;

  function addCarte(siteId: number, centreId: number, statut: string, isDirty: number) {
    seq += 1;
    db.prepare(`INSERT INTO t_cartes (noms, prenoms, num_secu, statut, is_dirty, site_id, centre_id, sync_id)
                VALUES ('N', 'P', ?, ?, ?, ?, ?, ?)`)
      .run(`1${String(seq).padStart(12, '0')}`, statut, isDirty, siteId, centreId, `cc-${seq}`);
  }

  // Copie littérale du SQL `total` de stats-worker.js (case 'getStats', activeWhereClause).
  function workerTotal(siteId: number, centreId: number): number {
    return (db.prepare(`SELECT COUNT(*) as total FROM t_cartes
      WHERE site_id = @siteId AND centre_id = @centreId AND is_dirty != -1 AND statut != 'BROUILLON'`)
      .get({ siteId, centreId }) as { total: number }).total;
  }

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    cfg = await import('../src/main/database/queries/config.queries');
    db = await connection.initDatabase();

    for (const [id, code] of [[SITE_A, 'SA'], [SITE_B, 'SB']] as const) {
      db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, ?, ?, 1, ?)`).run(id, code, code, `s-${id}`);
    }
    centreA1 = db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'A1', 'c-a1')`).run(SITE_A).lastInsertRowid as number;
    centreA2 = db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'A2', 'c-a2')`).run(SITE_A).lastInsertRowid as number;
    centreB1 = db.prepare(`INSERT INTO t_centres (site_id, nom, sync_id) VALUES (?, 'B1', 'c-b1')`).run(SITE_B).lastInsertRowid as number;

    // Centre A1 : 3 EN STOCK + 1 DELIVRE + 1 DOUBLON (comptés = 5) ; 2 BROUILLON + 2 is_dirty=-1 (exclus)
    for (let i = 0; i < 3; i++) addCarte(SITE_A, centreA1, 'EN STOCK', 0);
    addCarte(SITE_A, centreA1, 'DELIVRE', 1);
    addCarte(SITE_A, centreA1, 'DOUBLON', 0);
    addCarte(SITE_A, centreA1, 'BROUILLON', 0);
    addCarte(SITE_A, centreA1, 'BROUILLON', 1);
    addCarte(SITE_A, centreA1, 'EN STOCK', -1);
    addCarte(SITE_A, centreA1, 'DELIVRE', -1);
    // Autre centre du même site, et autre site
    for (let i = 0; i < 4; i++) addCarte(SITE_A, centreA2, 'EN STOCK', 0);
    for (let i = 0; i < 7; i++) addCarte(SITE_B, centreB1, 'EN STOCK', 0);
  });

  afterAll(() => {
    connection.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('jeu mixte : même nombre que `total` de getStats et de getCentreStats', async () => {
    expect(cfg.getCentreCardsCount(SITE_A, centreA1)).toBe(5);
    expect(cfg.getCentreCardsCount(SITE_A, centreA1)).toBe(workerTotal(SITE_A, centreA1));
    expect((await cfg.getCentreStats(centreA1, SITE_A)).total).toBe(5);
    expect(cfg.getCentreCardsCount(SITE_A, centreA2)).toBe(4);
    expect(cfg.getCentreCardsCount(SITE_B, centreB1)).toBe(7);
  });

  it('site/centre incohérents ou absents : 0 (comme getStats, pas de fuite)', () => {
    expect(cfg.getCentreCardsCount(SITE_B, centreA1)).toBe(0);
    expect(cfg.getCentreCardsCount(SITE_A, null)).toBe(0);
    expect(cfg.getCentreCardsCount(undefined, centreA1)).toBe(0);
  });

  it('le plan de requête utilise un index (pas de SCAN complet de t_cartes)', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) AS total FROM t_cartes
      WHERE site_id = ? AND centre_id = ? AND is_dirty != -1 AND statut != 'BROUILLON'`)
      .all(SITE_A, centreA1).map((r: any) => r.detail as string).join(' | ');
    expect(plan).toMatch(/USING (COVERING )?INDEX/);
    expect(plan).not.toMatch(/SCAN (t_cartes|TABLE t_cartes)(?! USING)/);
  });

  describe('resolveCentreCardsCountScope (cloisonnement)', () => {
    it('ADMIN_CENTRE : paramètres forcés vers un autre centre/site ignorés, session imposée', () => {
      const s = { role: 'ADMIN_CENTRE', site_id: SITE_A, centre_id: centreA1 };
      const scope = cfg.resolveCentreCardsCountScope(s, SITE_B, centreB1);
      expect(scope).toEqual({ siteId: SITE_A, centreId: centreA1 });
      expect(cfg.getCentreCardsCount(scope!.siteId, scope!.centreId)).toBe(5);
    });

    it('OPERATEUR_VERIFICATION : idem (centre de session, jamais celui reçu)', () => {
      const s = { role: 'OPERATEUR_VERIFICATION', site_id: SITE_A, centre_id: centreA2 };
      const scope = cfg.resolveCentreCardsCountScope(s, SITE_A, centreA1);
      expect(scope).toEqual({ siteId: SITE_A, centreId: centreA2 });
      expect(cfg.getCentreCardsCount(scope!.siteId, scope!.centreId)).toBe(4);
    });

    it('non-SUPER ADMIN sans centre en session : null => 0, jamais le centre reçu', () => {
      const scope = cfg.resolveCentreCardsCountScope({ role: 'ADMIN_CENTRE', site_id: SITE_A, centre_id: null }, SITE_A, centreA1);
      expect(scope).toEqual({ siteId: SITE_A, centreId: null });
      expect(cfg.getCentreCardsCount(scope!.siteId, scope!.centreId)).toBe(0);
    });

    it('SUPER ADMIN : paramètres reçus conservés', () => {
      expect(cfg.resolveCentreCardsCountScope({ role: 'SUPER ADMIN', site_id: SITE_A, centre_id: null }, SITE_B, centreB1))
        .toEqual({ siteId: SITE_B, centreId: centreB1 });
    });

    it('session absente ou rôle non autorisé : null (le handler refuse)', () => {
      expect(cfg.resolveCentreCardsCountScope(null, SITE_A, centreA1)).toBeNull();
      expect(cfg.resolveCentreCardsCountScope(undefined, SITE_A, centreA1)).toBeNull();
      expect(cfg.resolveCentreCardsCountScope({ role: 'OPERATEUR_SAISIE', site_id: SITE_A, centre_id: centreA1 }, SITE_A, centreA1)).toBeNull();
    });
  });

  it('mesure : COUNT sur ~60 000 cartes du centre (temps indicatif, aucune assertion stricte)', () => {
    const ins = db.prepare(`INSERT INTO t_cartes (noms, prenoms, num_secu, statut, is_dirty, site_id, centre_id, sync_id)
                            VALUES ('N','P',?, 'EN STOCK', 0, ?, ?, ?)`);
    db.transaction(() => {
      for (let i = 0; i < 60000; i++) ins.run(`2${String(i).padStart(12, '0')}`, SITE_A, centreA1, `bulk-${i}`);
    })();
    const t0 = performance.now();
    const n = cfg.getCentreCardsCount(SITE_A, centreA1);
    const ms = performance.now() - t0;
    console.log(`[MESURE] getCentreCardsCount sur ${n} cartes : ${ms.toFixed(1)} ms`);
    expect(n).toBe(60005);
    expect(n).toBe(workerTotal(SITE_A, centreA1));
  });
});
