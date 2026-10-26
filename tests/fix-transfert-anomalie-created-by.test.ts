import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * transfererAnomalieVersCarte écrivait created_by = 'CORRECTION' (texte) dans t_cartes, alors que
 * la colonne est un INTEGER localement et un BIGINT REFERENCES t_users(id_user) côté Supabase :
 * le payload outbox portait "created_by":"CORRECTION", refusé à l'upsert cloud.
 * Correctif : created_by = id_user de l'utilisateur de la session (ou null s'il est inconnu).
 * Base SQLite jetable (migrations réelles), synchro réseau coupée, données fictives.
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-created-by-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('transfert anomalie → carte : created_by numérique (jamais "CORRECTION")', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 950;
  const ID_USER = 42;
  const qualite = { role: 'OPERATEUR_QUALITE', site_id: SITE_ID, id_user: ID_USER, login: 'qualite.cb' };
  let seq = 0;

  /** ddn invalide par defaut (anomalie de date) ; une ddn valide simule une anomalie d'un autre champ. */
  const insertAnomalie = (ddn = '31/02/1980') => {
    seq += 1;
    return Number(db.prepare(`
      INSERT INTO t_import_anomalies (site_id, type_anomalie, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, contact, rangement)
      VALUES (?, 'DATE_INVALIDE', 'CREATEUR', ?, ?, 'BOUAKE', ?, '0500000000', 'R-9')
    `).run(SITE_ID, `PCB${seq}`, ddn, `5550000000${String(seq).padStart(3, '0')}`).lastInsertRowid);
  };
  const carte = (id: number) => db.prepare('SELECT *, typeof(created_by) AS t_created_by FROM t_cartes WHERE id_carte = ?').get(id) as any;
  const payloadOutbox = (syncId: string) => {
    const row = db.prepare("SELECT payload FROM t_outbox WHERE id = ? AND table_name = 't_cartes'").get(syncId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CB', 'SITE_CB', 1, 'site-cb')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('correction de date sur une anomalie : created_by = id_user (entier), payload outbox numérique', () => {
    const id = insertAnomalie();
    const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'date_de_naissance', valeur_apres: '1980-02-28', currentUser: qualite });
    expect(res.success).toBe(true);
    const c = carte(res.id_carte as number);
    expect(c.created_by).toBe(ID_USER);
    expect(c.t_created_by).toBe('integer');
    const p = payloadOutbox(c.sync_id);
    expect(p).toBeTruthy();
    expect(p.created_by).toBe(ID_USER);
  });

  it('correction d\'un autre champ (contact) sur une anomalie a date valide : idem', () => {
    // Date valide : sinon mapCardPayload refuse la carte et autoEnqueueCorrection ne l'enfile pas
    // (comportement existant, independant de created_by).
    const id = insertAnomalie('1980-02-28');
    const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'contact', valeur_apres: '0708091011', currentUser: qualite });
    expect(res.success).toBe(true);
    const c = carte(res.id_carte as number);
    expect(c.created_by).toBe(ID_USER);
    expect(c.t_created_by).toBe('integer');
    const p = payloadOutbox(c.sync_id);
    expect(p).toBeTruthy();
    expect(p.created_by).toBe(ID_USER);
  });

  it('utilisateur sans id_user : created_by = null, jamais "CORRECTION"', () => {
    const id = insertAnomalie();
    const res = queries.corrigerFormatQualite({ source: 't_import_anomalies', id, champ: 'date_de_naissance', valeur_apres: '1980-03-01', currentUser: { role: 'OPERATEUR_QUALITE', site_id: SITE_ID } });
    expect(res.success).toBe(true);
    const c = carte(res.id_carte as number);
    expect(c.created_by).toBeNull();
    const p = payloadOutbox(c.sync_id);
    expect(p).toBeTruthy();
    expect(p.created_by ?? null).toBeNull();
  });

  it('appel direct sans utilisateur (raccourci updateDateDeNaissance) : created_by = null', () => {
    const id = insertAnomalie();
    const r = queries.updateDateDeNaissance(id, '1980-04-04');
    expect(r.changes).toBe(1);
    const c = carte(Number(r.lastInsertRowid));
    expect(c.created_by).toBeNull();
    expect(c.agent_saisie).toBe('CORRECTION');
  });

  it('agent_saisie reste "CORRECTION" (colonne texte, sens métier)', () => {
    const id = insertAnomalie();
    const newId = queries.transfererAnomalieVersCarte(id, '1980-05-05', ID_USER);
    const c = carte(newId as number);
    expect(c.agent_saisie).toBe('CORRECTION');
    expect(c.created_by).toBe(ID_USER);
  });
});
