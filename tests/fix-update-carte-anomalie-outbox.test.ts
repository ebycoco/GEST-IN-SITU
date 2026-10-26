import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test terrain 2026-10-26 (P1-A) — la branche anomalie de `updateCarte` (bouton « Corriger » du
 * panneau CorrectionSidePanel → cartes:update, `_recordType` 'AnomalieImport' / 'En Anomalie')
 * créait la carte dans t_cartes (is_dirty = 1) sans l'enfiler dans t_outbox et avec
 * created_by = NULL : la carte n'était jamais envoyée automatiquement vers le cloud, contrairement
 * au chemin transfererAnomalieVersCarte / corrigerFormatQualite du même fichier.
 *
 * Attendu : INSERT + DELETE + enfilage outbox dans la même transaction ; created_by = id_user de
 * la session. Base SQLite jetable (migrations réelles), synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-update-anomalie-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('updateCarte — branche anomalie : enfilage outbox + created_by (test terrain 2026-10-26 P1-A)', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 950;
  const qualite = { role: 'OPERATEUR_QUALITE', site_id: SITE_ID, id_user: 7, login: 'qualite.test' };
  let seq = 0;

  /** Carte fictive + anomalie fictive portant EXACTEMENT le même numéro (collision réelle). */
  const insertCollision = (recordDate = '31/02/1980') => {
    seq += 1;
    const idCarte = Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex)
      VALUES (?, 'CARTE', ?, '1990-01-01', 'ABIDJAN', '0700000000', 'R-1', 'EN STOCK', ?, 0, 'X', 'X')
    `).run(SITE_ID, `PCARTE${seq}`, `sync-ua-${seq}`).lastInsertRowid);
    db.prepare(`
      INSERT INTO t_import_anomalies (id, site_id, type_anomalie, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, contact, rangement)
      VALUES (?, ?, 'DATE_INVALIDE', 'ANOMALIE', ?, ?, 'BOUAKE', ?, '0500000000', 'R-2')
    `).run(idCarte, SITE_ID, `PANO${seq}`, recordDate, `98765432101${String(seq).padStart(2, '0')}`);
    return idCarte;
  };
  const carte = (id: number) => db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
  const anomalie = (id: number) => db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;
  const nouvelleCarte = (prenoms: string) => db.prepare('SELECT * FROM t_cartes WHERE prenoms = ? AND noms = ?').get(prenoms, 'ANOMALIE') as any;

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_UA', 'SITE_UA', 1, 'site-ua')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(['AnomalieImport', 'En Anomalie'])(
    '_recordType %s + date valide : carte créée enfilée PENDING, created_by = id_user, anomalie supprimée, carte homonyme intacte',
    (recordType) => {
      const id = insertCollision();
      const carteAvant = carte(id);

      const res = queries.updateCarte(id, { _recordType: recordType, date_de_naissance: '1980-02-28' }, qualite);
      expect(res).toEqual({ changes: 1 });

      const nouvelle = nouvelleCarte(`PANO${seq}`);
      expect(nouvelle).toBeTruthy();
      expect(nouvelle.id_carte).not.toBe(id);
      expect(nouvelle.date_de_naissance).toBe('1980-02-28');
      expect(nouvelle.site_id).toBe(SITE_ID);
      expect(nouvelle.is_dirty).toBe(1);
      expect(nouvelle.created_by).toBe(qualite.id_user);

      // Quadriptyque : la carte créée est enfilée (payload complet) dans t_outbox.
      const outbox = db.prepare('SELECT table_name, operation, status, payload FROM t_outbox WHERE id = ?').get(nouvelle.sync_id) as any;
      expect(outbox).toBeTruthy();
      expect(outbox.table_name).toBe('t_cartes');
      expect(outbox.status).toBe('PENDING');
      expect(JSON.parse(outbox.payload).site_id).toBe(SITE_ID);

      expect(anomalie(id)).toBeUndefined();
      expect(carte(id)).toEqual(carteAvant);
      expect(db.prepare('SELECT 1 FROM t_outbox WHERE id = ?').get(carteAvant.sync_id)).toBeUndefined();
    }
  );

  it('anomalie inexistante : erreur, rien n\'est créé ni enfilé (transaction annulée)', () => {
    const avantOutbox = (db.prepare('SELECT COUNT(*) AS c FROM t_outbox').get() as { c: number }).c;
    expect(() => queries.updateCarte(99_999_003, { _recordType: 'AnomalieImport', date_de_naissance: '1980-02-28' }, qualite))
      .toThrow(/introuvable/);
    expect((db.prepare('SELECT COUNT(*) AS c FROM t_outbox').get() as { c: number }).c).toBe(avantOutbox);
  });
});
