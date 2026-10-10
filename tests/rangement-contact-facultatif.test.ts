import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * updateRangementEtFiche — contact facultatif (portail OPERATEUR_LOGISTIQUE).
 * Base SQLite jetable, synchro réseau coupée, données fictives (même gabarit que p0a-outbox-invariant).
 */

process.env.GEST_IN_SITU_E2E_DISABLE_SYNC = '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-contact-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

describe('updateRangementEtFiche — contact facultatif', () => {
  let connection: typeof import('../src/main/database/connection');
  let queries: typeof import('../src/main/database/queries/cartes.queries');
  let db: import('better-sqlite3').Database;
  const SITE_ID = 941;
  const logistique = { role: 'OPERATEUR_LOGISTIQUE', site_id: SITE_ID, login: 'logi.test' };

  const insert = (suffix: string, contact: string) =>
    Number(db.prepare(`
      INSERT INTO t_cartes (site_id, noms, prenoms, date_de_naissance, lieu_de_naissance, contact, rangement, statut, sync_id, is_dirty, cle_doublon, cle_doublon_flex)
      VALUES (?, 'DUPONT', ?, '1990-01-01', 'ABIDJAN', ?, NULL, 'EN STOCK', ?, 0, 'OLD', 'OLDFLEX')
    `).run(SITE_ID, `P${suffix}`, contact, `sync-ctc-${suffix}`).lastInsertRowid);

  const row = (id: number) => db.prepare('SELECT contact, rangement, cle_doublon, cle_doublon_flex FROM t_cartes WHERE id_carte = ?').get(id) as
    { contact: string; rangement: string; cle_doublon: string; cle_doublon_flex: string };

  beforeAll(async () => {
    connection = await import('../src/main/database/connection');
    queries = await import('../src/main/database/queries/cartes.queries');
    db = await connection.initDatabase();
    db.prepare(`INSERT INTO t_sites (id, nom, code, is_active, sync_id) VALUES (?, 'SITE_CTC', 'SITE_CTC', 1, 'site-ctc')`).run(SITE_ID);
  });

  afterAll(() => {
    connection?.closeDatabase();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rangement seul : contact et clés inchangés', () => {
    const id = insert('A', '0700000001');
    queries.updateRangementEtFiche(id, { rangement: 'r-1' }, logistique);
    const r = row(id);
    expect(r.rangement).toBe('R-1');
    expect(r.contact).toBe('0700000001');
    expect(r.cle_doublon).toBe('OLD');
    expect(r.cle_doublon_flex).toBe('OLDFLEX');
  });

  it('rangement + contact valide : contact normalisé et clés recalculées', () => {
    const id = insert('B', '');
    queries.updateRangementEtFiche(id, { rangement: 'R-2', contact: '+225 07 08 09 00 10' }, logistique);
    const r = row(id);
    expect(r.contact).toBe('0708090010');
    expect(r.cle_doublon).toBe('DUPONT|PB|1990-01-01|ABIDJAN|0708090010');
    expect(r.cle_doublon_flex).toBe('DUPONT|PB|1990-01-01|0708090010');
  });

  it.each([[undefined], [''], ['   ']])('contact vide (%j) : le contact existant n\'est pas écrasé', (val) => {
    const id = insert(`C${String(val).length}`, '0700000003');
    queries.updateRangementEtFiche(id, { rangement: 'R-3', contact: val }, logistique);
    const r = row(id);
    expect(r.contact).toBe('0700000003');
    expect(r.cle_doublon).toBe('OLD');
  });

  it('contact invalide : erreur claire, aucune écriture (rangement non modifié)', () => {
    const id = insert('D', '0700000004');
    expect(() => queries.updateRangementEtFiche(id, { rangement: 'R-4', contact: '12345' }, logistique))
      .toThrow('Le contact doit faire exactement 10 chiffres locaux.');
    const r = row(id);
    expect(r.rangement).toBeNull();
    expect(r.contact).toBe('0700000004');
  });

  it.each([['07080900101'], ['070809001012'], ['0708090010a'], ['+225 07 08 09 00 10 1']])(
    'contact %j (11/12 chiffres, lettre ou 14 chiffres) : refusé sans aucune écriture',
    (val) => {
      const id = insert(`E${val.length}${val.charCodeAt(val.length - 1)}`, '0700000005');
      expect(() => queries.updateRangementEtFiche(id, { rangement: 'R-5', contact: val }, logistique))
        .toThrow('Le contact doit faire exactement 10 chiffres locaux.');
      const r = row(id);
      expect(r.rangement).toBeNull();
      expect(r.contact).toBe('0700000005');
    }
  );

  it.each([['0708090010', '0708090010'], ['+2250708090010', '0708090010'], ['225 07 08 09 00 10', '0708090010']])(
    'contact %j (10 chiffres ou +225 + 10) : accepté',
    (val, expected) => {
      const id = insert(`F${val.length}`, '');
      queries.updateRangementEtFiche(id, { rangement: 'R-6', contact: val }, logistique);
      expect(row(id).contact).toBe(expected);
    }
  );

  describe('P1-1 — audit CONTACT_CARTE_MODIFIE', () => {
    const logs = (id: number) => db.prepare(
      `SELECT * FROM t_logs WHERE action = 'CONTACT_CARTE_MODIFIE' AND valeur_apres LIKE ?`
    ).all(`%"id_carte":${id},%`) as Array<{ detail: string; valeur_avant: string; valeur_apres: string; is_dirty: number; sync_id: string; site_id: number; login_user: string }>;

    it('contact modifié : une ligne t_logs avec ancien et nouveau contact', () => {
      const id = insert('L1', '0700000011');
      queries.updateRangementEtFiche(id, { rangement: 'R-L1', contact: '0708090011' }, logistique);
      const l = logs(id);
      expect(l).toHaveLength(1);
      expect(JSON.parse(l[0].valeur_apres)).toEqual({ id_carte: id, contact_avant: '0700000011', contact_apres: '0708090011' });
      expect(JSON.parse(l[0].valeur_avant)).toEqual({ id_carte: id, contact: '0700000011' });
      expect(l[0].detail).toContain('0700000011 -> 0708090011');
      expect(l[0].is_dirty).toBe(1);
      expect(l[0].sync_id).toBeTruthy();
      expect(l[0].site_id).toBe(SITE_ID);
      expect(l[0].login_user).toBe('logi.test');
    });

    it.each([[undefined], [''], ['   ']])('contact absent/vide (%j) : aucune ligne', (val) => {
      const id = insert(`L2${String(val).length}`, '0700000012');
      queries.updateRangementEtFiche(id, { rangement: 'R-L2', contact: val }, logistique);
      expect(logs(id)).toHaveLength(0);
    });

    it('contact inchangé : aucune ligne', () => {
      const id = insert('L3', '0700000013');
      queries.updateRangementEtFiche(id, { rangement: 'R-L3', contact: '+225 0700000013' }, logistique);
      expect(logs(id)).toHaveLength(0);
    });

    it('contact invalide : erreur, aucune ligne', () => {
      const id = insert('L4', '0700000014');
      expect(() => queries.updateRangementEtFiche(id, { rangement: 'R-L4', contact: '123' }, logistique)).toThrow();
      expect(logs(id)).toHaveLength(0);
    });
  });

  describe('P1-2 — doublonBloqueSync', () => {
    const outboxCount = (syncId: string) =>
      (db.prepare('SELECT COUNT(*) as c FROM t_outbox WHERE id = ?').get(syncId) as { c: number }).c;

    it('contact créant un doublon strict : true, rien en t_outbox, écritures conservées', () => {
      // Carte témoin déjà porteuse de la clé qui sera produite.
      const autre = insert('DUPX', '0709000001');
      db.prepare('UPDATE t_cartes SET prenoms = ?, cle_doublon = ? WHERE id_carte = ?').run('PDUP', 'DUPONT|PDUP|1990-01-01|ABIDJAN|0709000002', autre);
      const id = insert('DUP', '');
      const res = queries.updateRangementEtFiche(id, { rangement: 'R-D', contact: '0709000002' }, logistique);
      expect(res.doublonBloqueSync).toBe(true);
      expect(res.changes).toBe(1);
      expect(typeof res.lastInsertRowid).toBe('number');
      expect(() => structuredClone(res)).not.toThrow();
      expect(outboxCount(`sync-ctc-DUP`)).toBe(0);
      const r = row(id);
      expect(r.rangement).toBe('R-D');
      expect(r.contact).toBe('0709000002');
    });

    it('contact sans doublon : false et t_outbox alimentée', () => {
      const id = insert('NODUP', '');
      const res = queries.updateRangementEtFiche(id, { rangement: 'R-N', contact: '0709000003' }, logistique);
      expect(res.doublonBloqueSync).toBe(false);
      expect(outboxCount('sync-ctc-NODUP')).toBeGreaterThan(0);
    });

    it('sans contact écrit : false', () => {
      const id = insert('NOCT', '0709000004');
      expect(queries.updateRangementEtFiche(id, { rangement: 'R-C' }, logistique).doublonBloqueSync).toBe(false);
    });
  });
});
