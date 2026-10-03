import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * P0-A (audit Phase 1 du 27/09/2026) — TESTS DE CARACTÉRISATION (aucun code de production modifié).
 *
 * Invariant visé : « aucune carte is_dirty=1 sans entrée t_outbox PENDING/ERROR correspondante,
 * sauf exception métier documentée ». Ces tests figent le comportement ACTUEL de
 * autoEnqueueCorrection() (cartes.queries.ts) via les deux voies Logistique/Qualité :
 * - carte valide           → enfilée (invariant respecté) ;
 * - doublon strict/probable, date invalide, identité vide, sync_id absent
 *                          → mutation appliquée et renvoyée comme réussie, is_dirty=1,
 *                            AUCUNE entrée outbox, AUCUNE erreur remontée (perte silencieuse).
 * La politique métier (bloquer ou non l'envoi des doublons) et le mécanisme de rattrapage
 * restent soumis à validation : voir le rapport Phase 2. La requête DIRTY_SANS_OUTBOX ci-dessous
 * est la détection lecture seule proposée.
 *
 * Base SQLite jetable, synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-p0a-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

/** Détection proposée (lecture seule, indexable par site) : cartes modifiées sans file d'envoi. */
const DIRTY_SANS_OUTBOX = `
  SELECT c.id_carte FROM t_cartes c
  WHERE c.site_id = ? AND c.is_dirty = 1
    AND NOT EXISTS (SELECT 1 FROM t_outbox o WHERE o.id = c.sync_id AND o.status IN ('PENDING', 'ERROR'))
  ORDER BY c.id_carte
`;

describe('P0-A — enfilage outbox après correction Logistique / Qualité (caractérisation)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 940;
  const logistique = { role: 'OPERATEUR_LOGISTIQUE', site_id: SITE_ID, id_user: 9, login: 'logi.test' };

  const insert = (o: { suffix: string; noms?: string; prenoms?: string; ddn?: string | null; lieu?: string; cle?: string; sync?: string | null }) =>
    Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex)
      VALUES (?, ?, ?, ?, ?, '0700000000', 'R-1', 'EN STOCK', ?, 0, ?, ?)
    `).run(SITE_ID, o.noms ?? 'NOM', o.prenoms ?? `P_${o.suffix}`, o.ddn === undefined ? '1990-01-01' : o.ddn, o.lieu ?? 'ABIDJAN',
      o.sync === undefined ? `sync-p0a-${o.suffix}` : o.sync, o.cle ?? `CLE_${o.suffix}`, `FLEX_${o.suffix}`).lastInsertRowid);

  const outboxFor = (syncId: string | null) =>
    syncId ? db.prepare(`SELECT status, operation FROM t_outbox WHERE id = ?`).all(syncId) as { status: string; operation: string }[] : [];
  const dirty = (id: number) => (db.prepare('SELECT is_dirty FROM t_cartes WHERE id_carte = ?').get(id) as { is_dirty: number }).is_dirty;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_P0A', 'SITE_P0A', 1, 'site-p0a')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('carte valide → is_dirty=1 ET une entrée outbox PENDING avec payload complet (invariant respecté)', () => {
    const id = insert({ suffix: 'OK' });
    queries.updateRangementEtFiche(id, { rangement: 'R-2' }, logistique);
    expect(dirty(id)).toBe(1);
    expect(outboxFor('sync-p0a-OK')).toEqual([{ status: 'PENDING', operation: 'UPDATE' }]);
    const payload = JSON.parse((db.prepare(`SELECT payload FROM t_outbox WHERE id = ?`).get('sync-p0a-OK') as { payload: string }).payload);
    expect(payload.site_id).toBe(SITE_ID);
    expect(payload.rangement).toBe('R-2');
  });

  it('idempotence : deux corrections successives → UNE seule entrée outbox (upsert sur sync_id), payload à jour', () => {
    const id = insert({ suffix: 'IDEM' });
    queries.updateRangementEtFiche(id, { rangement: 'R-3' }, logistique);
    queries.updateRangementEtFiche(id, { rangement: 'R-4' }, logistique);
    expect(outboxFor('sync-p0a-IDEM')).toHaveLength(1);
    const payload = JSON.parse((db.prepare(`SELECT payload FROM t_outbox WHERE id = ?`).get('sync-p0a-IDEM') as { payload: string }).payload);
    expect(payload.rangement).toBe('R-4');
  });

  it.each([
    ['doublon strict (même cle_doublon)', () => { insert({ suffix: 'DS_JUMEAU', cle: 'CLE_PARTAGEE' }); return insert({ suffix: 'DS', cle: 'CLE_PARTAGEE' }); }, 'sync-p0a-DS'],
    ['doublon probable (même identité, clés différentes)', () => { insert({ suffix: 'DP_JUMEAU', noms: 'PROB', prenoms: 'ABLE' }); return insert({ suffix: 'DP', noms: 'PROB', prenoms: 'ABLE' }); }, 'sync-p0a-DP'],
    ['date de naissance invalide', () => insert({ suffix: 'DI', ddn: '31/02/1990' }), 'sync-p0a-DI'],
    ['identité vide (noms, prénoms, date)', () => insert({ suffix: 'IV', noms: '', prenoms: '', ddn: null }), 'sync-p0a-IV'],
  ])('%s → correction « réussie », is_dirty=1, AUCUNE entrée outbox (perte silencieuse actuelle)', (_label, make, syncId) => {
    const id = make();
    expect(() => queries.updateRangementEtFiche(id, { rangement: 'R-9' }, logistique)).not.toThrow();
    expect(dirty(id)).toBe(1);
    expect(outboxFor(syncId)).toHaveLength(0);
  });

  it('sync_id absent → correction « réussie », is_dirty=1, aucune entrée outbox', () => {
    const id = insert({ suffix: 'NOSYNC', sync: null });
    expect(() => queries.updateQuickFields(id, { rangement: 'R-5' }, logistique)).not.toThrow();
    expect(dirty(id)).toBe(1);
  });

  it('la détection lecture seule proposée isole exactement les cartes en perte silencieuse (et rien d\'autre)', () => {
    const ids = (db.prepare(DIRTY_SANS_OUTBOX).all(SITE_ID) as { id_carte: number }[]).map(r => r.id_carte);
    const attendus = (db.prepare(`
      SELECT id_carte FROM t_cartes WHERE site_id = ? AND is_dirty = 1
        AND (sync_id IS NULL OR sync_id IN ('sync-p0a-DS', 'sync-p0a-DP', 'sync-p0a-DI', 'sync-p0a-IV'))
      ORDER BY id_carte
    `).all(SITE_ID) as { id_carte: number }[]).map(r => r.id_carte);
    expect(ids).toEqual(attendus);
    expect(ids).toHaveLength(5);
    // Les cartes correctement enfilées ne sont jamais signalées (pas de faux positif).
    const okId = (db.prepare(`SELECT id_carte FROM t_cartes WHERE sync_id = 'sync-p0a-OK'`).get() as { id_carte: number }).id_carte;
    expect(ids).not.toContain(okId);
  });
});
