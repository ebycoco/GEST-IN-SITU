import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * getCartesMalCentrees — exclusion des statuts DELIVRE/DOUBLON (verrous de corrigerCentreCarte),
 * statut EN STOCK / NULL conservé, cloisonnement site_id.
 * Base SQLite jetable, synchro réseau coupée, données fictives (gabarit rangement-contact-facultatif).
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-malcentrees-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('getCartesMalCentrees — exclusion DELIVRE/DOUBLON', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_A = 951;
  const SITE_B = 952;
  let centreA1 = 0;
  let centreA2 = 0;
  let centreB1 = 0;
  const ids: Record<string, number> = {};

  const insertCarte = (key: string, site: number, statut: string | null, centre: number, rangement = 'ZZ-1') => {
    ids[key] = Number(db.prepare(`
      INSERT INTO t_cartes (site_id, centre_id, noms, prenoms, date_de_naissance, lieu_de_naissance, rangement, statut, sync_id, is_dirty)
      VALUES (?, ?, 'NOM', ?, '1990-01-01', 'ABIDJAN', ?, ?, ?, 0)
    `).run(site, centre, key, rangement, statut, `sync-mc-${key}`).lastInsertRowid);
  };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    for (const [id, code] of [[SITE_A, 'SITE_MCA'], [SITE_B, 'SITE_MCB']] as const) {
      db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, ?, ?, 1, ?)`).run(id, code, code, `site-${code}`);
    }
    const insCentre = (site: number, nom: string, prefixe: string) =>
      Number(db.prepare(`INSERT INTO t_centres (site_id, nom, prefixe_rangement, sync_id) VALUES (?, ?, ?, ?)`)
        .run(site, nom, prefixe, `centre-${nom}`).lastInsertRowid);
    centreA1 = insCentre(SITE_A, 'CENTRE_A1', 'ZZ');
    centreA2 = insCentre(SITE_A, 'CENTRE_A2', 'YY');
    centreB1 = insCentre(SITE_B, 'CENTRE_B1', 'ZZ');

    // Toutes mal-centrées (rangement ZZ => A1, centre actuel A2)
    insertCarte('STOCK', SITE_A, 'EN STOCK', centreA2);
    insertCarte('DELIVRE', SITE_A, 'DELIVRE', centreA2);
    insertCarte('DOUBLON', SITE_A, 'DOUBLON', centreA2);
    // Carte du site B (ne doit jamais apparaître pour le site A)
    insertCarte('SITEB', SITE_B, 'EN STOCK', centreA2 /* centre faux volontairement */, 'ZZ-1');
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exclut DELIVRE et DOUBLON, conserve la carte en stock mal-centrée', () => {
    const res = queries.getCartesMalCentrees(SITE_A);
    const got = res.map(r => r.id_carte).sort();
    expect(got).toContain(ids.STOCK);
    expect(got).not.toContain(ids.DELIVRE);
    expect(got).not.toContain(ids.DOUBLON);
    expect(res.find(r => r.id_carte === ids.STOCK)?.centre_id_attendu).toBe(centreA1);
  });

  it('cloisonnement site : aucune carte du site B pour le site A (et inversement)', () => {
    expect(queries.getCartesMalCentrees(SITE_A).map(r => r.id_carte)).not.toContain(ids.SITEB);
    const resB = queries.getCartesMalCentrees(SITE_B).map(r => r.id_carte);
    expect(resB).toContain(ids.SITEB);
    expect(resB).not.toContain(ids.STOCK);
    expect(centreB1).toBeGreaterThan(0);
  });

  it('statut NULL n\'est pas exclu par erreur', () => {
    // schema.ts : `statut TEXT DEFAULT 'EN STOCK' CHECK(statut IN (...))` — colonne nullable (un CHECK
    // évalué à NULL passe). L'INSERT d'un statut NULL explicite doit donc réussir ; s'il lève, le test
    // échoue (pas de repli silencieux).
    expect(() => insertCarte('NULLSTAT', SITE_A, null, centreA2)).not.toThrow();
    const stored = db.prepare('SELECT statut FROM t_cartes WHERE id_carte = ?').get(ids.NULLSTAT) as { statut: string | null };
    expect(stored.statut).toBeNull();
    expect(queries.getCartesMalCentrees(SITE_A).map(r => r.id_carte)).toContain(ids.NULLSTAT);
  });
});
