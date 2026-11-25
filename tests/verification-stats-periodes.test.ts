import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Vue d'ensemble de l'opérateur de vérification (getVerificationStats).
 *
 * Avant : « Cette semaine » comptait depuis J-7 (8 jours) et « Ce mois » depuis J-30, sans borne
 * de fin (une date de délivrance mal saisie, ex. année 52025, restait comptée).
 *
 * Après : semaine du lundi au dimanche, mois et année du calendrier, bornes de fin exclusives.
 *
 * Base SQLite jetable, synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-verif-stats-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('getVerificationStats — périodes calendaires', () => {
  let connection: typeof import('../src/main/database/connection');
  let stats: typeof import('../src/main/database/queries/stats.queries');
  let db: import('better-sqlite3').Database;
  let nextSite = 970;
  let seq = 0;

  /** Un site neuf par scénario, avec une carte délivrée par date fournie. */
  const siteAvecDelivrances = (dates: string[]) => {
    const id = nextSite++;
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, ?, ?, 1, ?)`)
      .run(id, `SITE_${id}`, `S${id}`, `site-vs-${id}`);
    for (const date of dates) {
      seq++;
      db.prepare(`
        INSERT INTO t_cartes (site_id, noms, prenoms, statut, agent_distributeur, date_delivrance, sync_id)
        VALUES (?, ?, ?, 'DELIVRE', 'AGENT_TEST', ?, ?)
      `).run(id, `NOM${seq}`, `PRE${seq}`, date, `sync-vs-${seq}`);
    }
    return id;
  };

  const statsLe = (maintenant: string, siteId: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(maintenant));
    return stats.getVerificationStats('agent_test', siteId);
  };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    stats = await import('../src/main/database/queries/stats.queries');
    db = await connection.initDatabase();
  }, 60_000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mercredi : la semaine part du lundi, le mois du 1er', () => {
    const site = siteAvecDelivrances([
      '2026-10-30T10:00:00.000Z', // mois précédent
      '2026-11-01T00:00:00.000Z', // 1er du mois
      '2026-11-22T23:59:59.000Z', // dimanche précédent
      '2026-11-23T00:00:00.000Z', // lundi
      '2026-11-24T12:00:00+00:00', // mardi (format cloud)
      '2026-11-25T08:00:00.000Z' // aujourd'hui
    ]);
    const s = statsLe('2026-11-25T09:00:00.000Z', site);
    expect({ today: s.today, yesterday: s.yesterday, week: s.week, month: s.month, year: s.year })
      .toEqual({ today: 1, yesterday: 1, week: 3, month: 5, year: 6 });
  });

  it('lundi : la semaine ne contient que le jour même', () => {
    const site = siteAvecDelivrances(['2026-11-22T10:00:00.000Z', '2026-11-23T08:00:00.000Z']);
    expect(statsLe('2026-11-23T09:00:00.000Z', site).week).toBe(1);
  });

  it('dimanche : la semaine va du lundi précédent au dimanche inclus', () => {
    const site = siteAvecDelivrances([
      '2026-11-22T10:00:00.000Z', // dimanche précédent : exclu
      '2026-11-23T10:00:00.000Z',
      '2026-11-29T10:00:00.000Z',
      '2026-11-30T00:00:00.000Z' // lundi suivant : exclu
    ]);
    expect(statsLe('2026-11-29T23:00:00.000Z', site).week).toBe(2);
  });

  it('passage d\'année : la semaine à cheval garde les jours de décembre', () => {
    const site = siteAvecDelivrances([
      '2026-12-28T10:00:00.000Z',
      '2026-12-31T10:00:00.000Z',
      '2027-01-01T08:00:00.000Z'
    ]);
    const s = statsLe('2027-01-01T09:00:00.000Z', site);
    expect({ week: s.week, month: s.month, year: s.year }).toEqual({ week: 3, month: 1, year: 1 });
  });

  it('dates de délivrance aberrantes (futur) : jamais comptées', () => {
    const site = siteAvecDelivrances(['52025-11-23T10:00:00.000Z', '275760-01-01', '2027-03-01']);
    const s = statsLe('2026-11-25T09:00:00.000Z', site);
    expect({ today: s.today, week: s.week, month: s.month, year: s.year })
      .toEqual({ today: 0, week: 0, month: 0, year: 0 });
  });
});
